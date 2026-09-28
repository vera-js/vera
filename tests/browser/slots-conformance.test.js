/**
 * **Light-DOM slots against the platform: the conformance suite.**
 *
 * Every scenario renders the SAME template twice — into a shadow root, where the engine's own slot
 * assignment is the oracle, and into a plain host, where `@verajs/renderer/slots` has to produce the
 * same thing — then applies the same steps to both and compares what a reader would see after each.
 *
 * "What a reader sees" is the composed tree: on the native side every `<slot>` in a shadow tree is
 * replaced by `assignedNodes({ flatten: true })` (fallback included) and every shadow host by its
 * shadow root; on the light side it is simply the host's DOM. Comments are skipped on both sides
 * (they are the renderer's markers) and adjacent text is merged, so a light side that splits a text
 * node differently is not a divergence — a light side that shows different text is.
 *
 * **Identity is compared as well as shape.** Each side numbers its elements in the order they first
 * appear, and the numbers are part of the view. A light side that re-creates a node — losing focus,
 * a typed value, a running video — numbers it afresh, and the views stop matching even though the
 * markup is identical. Rendered `textContent` alone would pass that, which is why this reads the
 * tree instead.
 *
 * The scenarios are every shape four rounds of auditing this feature found, each written from the
 * auditor's own probe rather than a paraphrase of it, plus the open risks of replacing the design
 * (hosts nested in another component's template, content one template PLACES into another component,
 * a node moved between hosts). **Hydration is not here** — it needs markup a real server produced,
 * and gets its own suite over generated fixtures.
 *
 * **KNOWN lists the scenarios where light slots diverge today**, each with the audit finding it is.
 * A known scenario asserts that it STILL diverges: the day one conforms, this suite goes red until it
 * comes off the list, so the list only ever shrinks by being fixed, never by being forgotten. The
 * count of conforming scenarios is the redesign's scoreboard.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer, hold } from '../../packages/renderer/dist/development/vera-renderer.js';
import { keyed } from '../../packages/renderer/dist/development/vera-renderer-keyed.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire, init, render } from '../../packages/core/dist/development/vera.js';

wire([renderer, slots]);

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const settle = async () => {
  await frame();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

/** Components used INSIDE a scenario's template — one per mode, the same template in each. */
const card = () => html`<article><header><slot name="h">no title</slot></header><slot>no body</slot></article>`;
const panel = () => html`<section><slot>panel empty</slot></section>`;
const box = () => html`<div class="box"><slot>FB</slot></div>`;
/**
 * A component whose own render fires whatever is armed in `fireNext` from a ref — a commit landing
 * DURING that render. Armed before the outer render, since a component renders on connect.
 */
let fireNext = null;
const firing = () => html`<span &ref=${() => { const fire = fireNext; fireNext = null; fire?.(); }}></span><main><slot>HFB</slot></main>`;
for (const [name, template] of [['cf-card', card], ['cf-panel', panel], ['cf-box', box], ['cf-fire', firing]]) {
  customElements.define(`${name}-native`, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => template(this));
    }
  });
  customElements.define(`${name}-light`, class extends HTMLElement {
    connectedCallback() {
      init(this);
      render(() => template(this));
    }
  });
}

/** The composed view of a side's hosts, with elements numbered by first appearance. */
const view = (side) => {
  let out = '';
  let text = '';
  const flush = () => {
    if (text !== '') out += JSON.stringify(text);
    text = '';
  };
  const number = (node) => {
    let n = side.ids.get(node);
    if (n === undefined) side.ids.set(node, (n = ++side.count));
    return n;
  };
  const walk = (node) => {
    if (node.nodeType === 3) {
      text += node.data;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.localName === 'slot' && node.getRootNode() instanceof ShadowRoot) {
      for (const assigned of node.assignedNodes({ flatten: true })) walk(assigned);
      return;
    }
    flush();
    const tag = node.localName.replace(/-(native|light)$/, '');
    const attrs = [...node.attributes].map((a) => ` ${a.name}="${a.value}"`).sort().join('');
    out += `<${tag}#${number(node)}${attrs}>`;
    for (const child of (node.shadowRoot ?? node).childNodes) walk(child);
    flush();
    out += `</${tag}>`;
  };
  side.hosts.forEach((host, i) => {
    out += i === 0 ? '' : ' || ';
    for (const child of side.targets[i].childNodes) walk(child);
    flush();
  });
  return out;
};

const el = (tag, attrs = {}, content = '') => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.textContent = content;
  return node;
};

/**
 * Runs one scenario on both sides. `draw(state, side)` is ONE function — one call site per template
 * — so a second render updates rather than rebuilds. `children(side)` builds the user's nodes, once
 * per side, appended before the first render as markup would be. Each step runs on both sides, the
 * page settles, and both views are read. `detached` leaves the hosts off the page until a step
 * attaches them; `side.parts` collects the parts of every `later()` applier, in the order attached.
 */
const run = async ({ draw, children = () => [], hosts = 1, detached = false, steps }) => {
  const sides = ['native', 'light'].map((mode) => {
    const side = { mode, ids: new Map(), count: 0, hosts: [], targets: [], parts: [] };
    for (let i = 0; i < hosts; i++) {
      const host = document.createElement('div');
      side.hosts.push(host);
      side.targets.push(mode === 'native' ? host.attachShadow({ mode: 'open' }) : host);
    }
    side.render = (state, i = 0) => renderInto(draw(state, side), side.targets[i]);
    side.user = children(side);
    side.hosts[0].append(...side.user);
    if (!detached) for (const host of side.hosts) document.body.appendChild(host);
    return side;
  });
  const trace = { native: [], light: [] };
  try {
    for (const [label, step] of steps)
      for (const side of sides) {
        try {
          await step(side);
          await settle();
          trace[side.mode].push(`${label}: ${view(side)}`);
        } catch (error) {
          trace[side.mode].push(`${label}: THREW ${error.name}: ${error.message}`);
        }
      }
  } finally {
    for (const side of sides) for (const host of side.hosts) host.remove();
  }
  return trace;
};

/**
 * name → what diverges. Filled from what the suite MEASURED on all three engines, never from what was
 * expected — every entry here was read from its trace and failed identically on Chromium, Firefox and
 * WebKit. The same list is described in prose in `docs/features/light-dom-slots.md` (the caveats),
 * `packages/renderer/README.md` (the slots section) and `llms.txt`: an entry added or removed here
 * changes all three in the same commit.
 */
const KNOWN = new Map([
  ['two slots with one name: the first takes the content, the second when the first goes',
    'when the earlier slot of a duplicate pair returns, the content stays in the later one'],
  ['a slot forwarded into a nested component\'s slot',
    'slot forwarding: the forwarded content never reaches the nested component, which shows the outer fallback'],
  ['placed content: hold() restores a template whose inner text became a template',
    'a hold() restore inside placed content keeps the old text beside the new node, and leaves it on screen after'],
]);

const scenario = (name, spec) =>
  it(name, async () => {
    const { native, light } = await run(spec);
    const views = native.map((line) => line.slice(line.indexOf(': ') + 2));
    expect(new Set(views).size > 1 || spec.steady === true, 'CONTROL: the native side changed between steps').to.equal(true);
    expect(views.some((v) => v.startsWith('THREW')), 'CONTROL: the oracle itself never throws').to.equal(false);
    const known = KNOWN.get(name);
    if (known === undefined) expect(light).to.deep.equal(native);
    else
      expect(JSON.stringify(light) === JSON.stringify(native), `KNOWN divergence (${known}) now CONFORMS — take it off KNOWN`)
        .to.equal(false);
  });

/* ------------------------------------------------------------------------------------------------ */
/* The component's own top-level content — round 1 B1, round 2 B1/B2                                 */
/* ------------------------------------------------------------------------------------------------ */

scenario('a top-level switch between two templates, in a component with no slot', {
  draw: (s) => html`${s.busy ? html`<i>spinner</i>` : html`<p>list</p>`}`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['busy', (side) => side.render({ busy: true })],
    ['done', (side) => side.render({ busy: false })],
    ['busy again', (side) => side.render({ busy: true })],
  ],
});

scenario('a top-level list grows and shrinks beside a slot', {
  draw: (s) => html`${s.items.map((i) => html`<li>${i}</li>`)}<slot>fallback</slot>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['one', (side) => side.render({ items: ['a'] })],
    ['three', (side) => side.render({ items: ['a', 'b', 'c'] })],
    ['one again', (side) => side.render({ items: ['b'] })],
  ],
});

scenario('a top-level keyed list reorders and inserts beside a slot', {
  draw: (s) => html`${s.items.map((i) => keyed(i, html`<li>${i}</li>`))}<slot>fallback</slot>`,
  children: () => [el('b', {}, 'user'), document.createTextNode('text')],
  steps: [
    ['abc', (side) => side.render({ items: ['a', 'b', 'c'] })],
    ['cab', (side) => side.render({ items: ['c', 'a', 'b'] })],
    ['insert', (side) => side.render({ items: ['c', 'x', 'a', 'b'] })],
    ['shrink', (side) => side.render({ items: ['b'] })],
  ],
});

scenario('a keyed row changes shape', {
  draw: (s) => html`<ul>${s.rows.map((r) => keyed(r.id, r.big ? html`<li><b>${r.id}</b></li>` : html`<li>${r.id}</li>`))}</ul><slot>fb</slot>`,
  children: () => [el('i', {}, 'user')],
  steps: [
    ['small', (side) => side.render({ rows: [{ id: 'a' }, { id: 'b' }] })],
    ['b grows', (side) => side.render({ rows: [{ id: 'a' }, { id: 'b', big: true }] })],
    ['reorder', (side) => side.render({ rows: [{ id: 'b', big: true }, { id: 'a' }] })],
  ],
});

scenario('a top-level text part becomes a template, an empty string, and text again', {
  draw: (s) => html`${s.v}<slot>fallback</slot>`,
  children: () => [document.createTextNode('U')],
  steps: [
    ['text', (side) => side.render({ v: 'text' })],
    ['template', (side) => side.render({ v: html`<em>t</em>` })],
    ['empty', (side) => side.render({ v: '' })],
    ['text again', (side) => side.render({ v: 'again' })],
  ],
});

scenario('the component renders nothing, then a slotted template', {
  draw: (s) => html`${s.on ? html`<div><slot>fb</slot></div>` : null}`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['nothing', (side) => side.render({ on: false })],
    ['template', (side) => side.render({ on: true })],
    ['nothing again', (side) => side.render({ on: false })],
    ['template again', (side) => side.render({ on: true })],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Clearing, holding, and content inside fallback — round 1 A3, round 2 A7/B6, round 3 A5            */
/* ------------------------------------------------------------------------------------------------ */

scenario('a slotted template toggled off and on inside an element', {
  draw: (s) => html`<div>${s.show ? html`<p><slot>fb</slot></p><slot name="x">X</slot>` : null}</div>`,
  children: () => [el('b', {}, 'd'), el('i', { slot: 'x' }, 'x')],
  steps: [
    ['show', (side) => side.render({ show: true })],
    ['hide', (side) => side.render({ show: false })],
    ['show again', (side) => side.render({ show: true })],
  ],
});

scenario('a slotted template toggled off and on at the top level (content partly moved)', {
  draw: (s) => html`${s.show ? html`<slot>fb</slot><b>own</b>` : 'none'}`,
  children: () => [el('i', {}, 'user'), document.createTextNode('t')],
  steps: [
    ['show', (side) => side.render({ show: true })],
    ['hide', (side) => side.render({ show: false })],
    ['show again', (side) => side.render({ show: true })],
  ],
});

scenario('hold() round-trips between two slotted templates', {
  draw: (s) => html`${hold(s.edit ? html`<form><slot name="a">A</slot></form>` : html`<section><slot name="b">B</slot><slot>D</slot></section>`)}`,
  children: () => [el('i', { slot: 'a' }, 'ia'), el('i', { slot: 'b' }, 'ib'), document.createTextNode('d')],
  steps: [
    ['edit', (side) => side.render({ edit: true })],
    ['view', (side) => side.render({ edit: false })],
    ['edit again', (side) => side.render({ edit: true })],
    ['view again', (side) => side.render({ edit: false })],
  ],
});

scenario('a swapped part inside fallback content keeps its order', {
  draw: (s) => html`<div><slot>${s.a ? html`<i>a</i>` : html`<i>a2</i>`}<b>b</b></slot></div>`,
  steps: [
    ['a', (side) => side.render({ a: true })],
    ['a2', (side) => side.render({ a: false })],
    ['a again', (side) => side.render({ a: true })],
  ],
});

scenario('a slot inside another slot\'s fallback takes over when the fallback shows', {
  draw: () => html`<div><slot name="o"><em>E</em><slot name="i">D</slot></slot></div>`,
  children: () => [el('u', { slot: 'o' }, 'OWN'), el('b', { slot: 'i' }, 'IN')],
  steps: [
    ['render', (side) => side.render({})],
    ['outer emptied', (side) => side.user[0].remove()],
    ['outer back', (side) => side.hosts[0].appendChild(side.user[0])],
  ],
});

scenario('two slots with one name: the first takes the content, the second when the first goes', {
  draw: (s) => html`${s.first ? html`<slot>one</slot>` : ''}<p><slot>two</slot></p>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['both', (side) => side.render({ first: true })],
    ['second only', (side) => side.render({ first: false })],
    ['both again', (side) => side.render({ first: true })],
  ],
});

scenario('a slot name bound to state re-routes between renders', {
  draw: (s) => html`<div><slot name=${s.n}>none</slot></div>`,
  children: () => [el('b', { slot: 'a' }, 'A'), el('b', { slot: 'b' }, 'B')],
  steps: [
    ['a', (side) => side.render({ n: 'a' })],
    ['b', (side) => side.render({ n: 'b' })],
    ['c', (side) => side.render({ n: 'c' })],
    ['a again', (side) => side.render({ n: 'a' })],
  ],
});

scenario('a slot in every keyed row follows its row through a reorder', {
  draw: (s) => html`<ul>${s.ids.map((id) => keyed(id, html`<li><slot name=${id}>${id}?</slot></li>`))}</ul>`,
  children: () => [el('b', { slot: 'a' }, 'A'), el('b', { slot: 'c' }, 'C')],
  steps: [
    ['abc', (side) => side.render({ ids: ['a', 'b', 'c'] })],
    ['cba', (side) => side.render({ ids: ['c', 'b', 'a'] })],
    ['drop a', (side) => side.render({ ids: ['c', 'b'] })],
    ['a back', (side) => side.render({ ids: ['a', 'c', 'b'] })],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Renders that happen at other times — round 1 B2, round 2 B5, round 3 A2/A3                        */
/* ------------------------------------------------------------------------------------------------ */

const tip = () => html`<span>tip</span>`;
scenario('a nested render during the first update keeps the slot\'s content', {
  draw: (s, side) => html`<div &ref=${() => renderInto(tip(), (side.tip ??= document.createElement('div')))}><slot>fb</slot>${s.n}</div>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['update', (side) => side.render({ n: 2 })],
    ['user adds', (side) => side.hosts[0].appendChild(el('i', {}, 'late'))],
  ],
});

/** A hoisted applier that commits a placeholder and hands its part to the scenario. */
function applyLater(part, previous) {
  if (previous) return previous;
  part._$commit$(this.placeholder);
  this.side.parts.push(part);
  return {};
}
const later = (side, placeholder) => ({ _$child$: applyLater, side, placeholder });
const loading = () => html`<i>loading</i>`;
const lateSlotted = () => html`<div><slot>late fb</slot></div>`;
const stray = () => html`<i>stray</i>`;

scenario('an applier commits a slotted template after the first render', {
  draw: (s, side) => html`<header>${s.n}</header>${later(side, loading())}`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['late commit', (side) => side.parts[0]._$commit$(lateSlotted())],
    ['re-render', (side) => side.render({ n: 2 })],
    ['user adds', (side) => side.hosts[0].appendChild(el('i', {}, 'late'))],
  ],
});

scenario('an applier whose part was removed commits nothing into the host', {
  draw: (s, side) => html`${s.show ? html`<p>${later(side, loading())}</p>` : html`<b>gone</b>`}<slot>fb</slot>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['show', (side) => side.render({ show: true })],
    ['hide', (side) => side.render({ show: false })],
    ['stale commit', (side) => side.parts[0]._$commit$(stray())],
    ['user adds', (side) => side.hosts[0].appendChild(el('i', {}, 'late'))],
  ],
});

const elsewhere = (side) => html`<u &ref=${() => side.parts[0]._$commit$(lateSlotted())}>x</u>`;
scenario('an applier commits during another host\'s render', {
  draw: (s, side) => html`<header>${s.n}</header>${later(side, loading())}`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['commit inside another render', (side) => renderInto(elsewhere(side), (side.other ??= document.createElement('div')))],
    ['user adds', (side) => side.hosts[0].appendChild(el('i', {}, 'late'))],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Hosts inside hosts — the redesign's open risk, and round 2 B7 (slot forwarding)                   */
/* ------------------------------------------------------------------------------------------------ */

scenario('a component in the template receives the children the template wrote for it', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-card-native><h2 slot="h">${s.title}</h2>${s.body}</cf-card-native>`
      : html`<cf-card-light><h2 slot="h">${s.title}</h2>${s.body}</cf-card-light>`,
  steps: [
    ['first', (side) => side.render({ title: 'one', body: 'b1' })],
    ['update', (side) => side.render({ title: 'two', body: 'b2' })],
    ['body gone', (side) => side.render({ title: 'three', body: null })],
  ],
});

scenario('a slot forwarded into a nested component\'s slot', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-panel-native><slot name="f">outer fb</slot>${s.n}</cf-panel-native>`
      : html`<cf-panel-light><slot name="f">outer fb</slot>${s.n}</cf-panel-light>`,
  children: () => [el('h3', { slot: 'f' }, 'forwarded')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['user removes', (side) => side.user[0].remove()],
    ['user re-adds', (side) => side.hosts[0].appendChild(side.user[0])],
    ['update', (side) => side.render({ n: 2 })],
  ],
});

scenario('a user node moved to another host and back', {
  hosts: 2,
  draw: () => html`<div><slot name="s">empty</slot></div>`,
  children: () => [el('b', { slot: 's' }, 'moving')],
  steps: [
    ['render both', (side) => { side.render({}, 0); side.render({}, 1); }],
    ['to the second', (side) => side.hosts[1].appendChild(side.user[0])],
    ['back to the first', (side) => side.hosts[0].appendChild(side.user[0])],
    ['re-render both', (side) => { side.render({}, 0); side.render({}, 1); }],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* The user's own edits — the platform's assignment rules                                           */
/* ------------------------------------------------------------------------------------------------ */

const shell = (s) => html`<div><slot name="a">A?</slot></div><main><slot>D?</slot></main><footer>${s.n}</footer>`;

scenario('late children join their slots in document order', {
  draw: shell,
  children: () => [el('b', { slot: 'a' }, 'a1')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['append text', (side) => side.hosts[0].appendChild(document.createTextNode('txt'))],
    ['append bare element', (side) => side.hosts[0].appendChild(el('i', {}, 'bare'))],
    ['insert before a slotted node', (side) => side.user[0].before(el('b', { slot: 'a' }, 'a0'))],
    ['prepend', (side) => side.hosts[0].prepend(el('u', {}, 'front'))],
    ['re-render', (side) => side.render({ n: 2 })],
  ],
});

scenario('re-slotting and removal restore fallback, and a re-render keeps the arrangement', {
  draw: shell,
  children: () => [el('b', { slot: 'a' }, 'a1'), el('i', {}, 'd1')],
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['re-slot a to default', (side) => side.user[0].setAttribute('slot', '')],
    ['re-slot to nowhere', (side) => side.user[0].setAttribute('slot', 'gone')],
    ['remove the default child', (side) => side.user[1].remove()],
    ['re-render', (side) => side.render({ n: 2 })],
    ['re-slot back', (side) => side.user[0].setAttribute('slot', 'a')],
  ],
});

scenario('whitespace appended to the host suppresses the default fallback', {
  draw: shell,
  steps: [
    ['render', (side) => side.render({ n: 1 })],
    ['append whitespace', (side) => side.hosts[0].appendChild(document.createTextNode('  '))],
    ['re-render', (side) => side.render({ n: 2 })],
  ],
});

scenario('a user edit between two renders is not taken for the component\'s own output', {
  draw: (s) => html`${s.items.map((i) => html`<li>${i}</li>`)}<main><slot>D?</slot></main>`,
  children: () => [el('b', {}, 'd1')],
  steps: [
    ['render', (side) => side.render({ items: ['a'] })],
    ['user appends', (side) => side.hosts[0].appendChild(el('i', {}, 'late'))],
    ['list grows', (side) => side.render({ items: ['a', 'b'] })],
    ['user removes the first', (side) => side.user[0].remove()],
    ['list shrinks', (side) => side.render({ items: [] })],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Top-level lists whose rows get markers LIVE in the host — round 2 B (p3, p3b, p1c)               */
/* ------------------------------------------------------------------------------------------------ */

scenario('a keyed list of multi-root rows takes a row in the middle', {
  draw: (s) => html`${s.ks.map((k) => keyed(k, html`<dt>${k}</dt><dd>d${k}</dd>`))}<slot>fb</slot>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['a c', (side) => side.render({ ks: ['a', 'c'] })],
    ['a b c', (side) => side.render({ ks: ['a', 'b', 'c'] })],
    ['c a', (side) => side.render({ ks: ['c', 'a'] })],
  ],
});

scenario('a keyed row inserted live then changes shape', {
  draw: (s) => html`${s.rows.map(([k, big]) => keyed(k, big ? html`<p><b>${k}</b></p>` : html`<p>${k}</p>`))}<slot>fb</slot>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['a c', (side) => side.render({ rows: [['a'], ['c']] })],
    ['b inserted', (side) => side.render({ rows: [['a'], ['b'], ['c']] })],
    ['b grows', (side) => side.render({ rows: [['a'], ['b', true], ['c']] })],
  ],
});

const one = (v) => html`<li>one ${v}</li>`;
const other = (v) => html`<li>other ${v}</li>`;
scenario('an index-list row changes template', {
  draw: (s) => html`${[one(1), s.flip ? other(2) : one(2)]}<slot>fb</slot>`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['same', (side) => side.render({ flip: false })],
    ['flipped', (side) => side.render({ flip: true })],
    ['back', (side) => side.render({ flip: false })],
  ],
});

const innerSwitch = (x) => (x ? html`<b>B</b>` : html`<i>I</i>`);
const multi = (x) => html`<span>s</span>${innerSwitch(x)}`;
scenario('an index list of multi-root rows whose inner part switches', {
  draw: (s) => html`${[multi(false), multi(s.x)]}<slot>fb</slot>`,
  children: () => [el('u', {}, 'user')],
  steps: [
    ['I', (side) => side.render({ x: false })],
    ['B', (side) => side.render({ x: true })],
    ['I again', (side) => side.render({ x: false })],
  ],
});

scenario('an index list of strings where one row becomes a template', {
  draw: (s) => html`${['p', s.x ? html`<em>q</em>` : 'q']}<slot>fb</slot>`,
  children: () => [el('u', {}, 'user')],
  steps: [
    ['strings', (side) => side.render({ x: false })],
    ['template', (side) => side.render({ x: true })],
    ['strings again', (side) => side.render({ x: false })],
  ],
});

scenario('the lit idiom: an empty string first, then the template', {
  draw: (s) => html`${s.on ? html`<div><slot>fb</slot></div>` : ''}`,
  children: () => [el('b', {}, 'user')],
  steps: [
    ['empty', (side) => side.render({ on: false })],
    ['template', (side) => side.render({ on: true })],
    ['empty again', (side) => side.render({ on: false })],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* PLACED content — an outer template's own parts as a nested component's children                 */
/* round 2 B6 (p6), round 2 A (p2-hold-slots), round 2 B (p7), round 3 A (p8b)                      */
/* ------------------------------------------------------------------------------------------------ */

const A1 = () => html`<i>a1</i>`;
const A2 = () => html`<i>a2</i>`;
const Bu = () => html`<u>b</u>`;
scenario('placed content: the first of two parts swaps template', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-box-native>${s.v ? A2() : A1()}${Bu()}</cf-box-native>`
      : html`<cf-box-light>${s.v ? A2() : A1()}${Bu()}</cf-box-light>`,
  steps: [
    ['a1 b', (side) => side.render({ v: false })],
    ['a2 b', (side) => side.render({ v: true })],
    ['a1 b again', (side) => side.render({ v: false })],
  ],
});

const withInner = (inner) => html`${inner}<i>A</i>`;
const onlyB = () => html`<b>B</b>`;
const U = () => html`<u>U</u>`;
scenario('placed content: hold() restores a template whose inner text became a template', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-box-native>${hold(s.v)}</cf-box-native>`
      : html`<cf-box-light>${hold(s.v)}</cf-box-light>`,
  steps: [
    ['A(text)', (side) => side.render({ v: withInner('t1') })],
    ['B', (side) => side.render({ v: onlyB() })],
    ['A(<u>) restored', (side) => side.render({ v: withInner(U()) })],
    ['B again', (side) => side.render({ v: onlyB() })],
    ['A(<u>) again', (side) => side.render({ v: withInner(U()) })],
  ],
});

scenario('top-level hold() restores a template whose inner text became a template', {
  draw: (s) => html`${hold(s.v)}<slot>fb</slot>`,
  children: () => [el('em', {}, 'user')],
  steps: [
    ['A(text)', (side) => side.render({ v: withInner('t1') })],
    ['B', (side) => side.render({ v: onlyB() })],
    ['A(<u>) restored', (side) => side.render({ v: withInner(U()) })],
    ['B again', (side) => side.render({ v: onlyB() })],
  ],
});

const headA = () => html`<h2 slot="h">AAA</h2>`;
const headB = () => html`<h2 slot="h">BBB</h2>`;
const em = (n) => html`<em>${n}</em>`;
scenario('placed content: a named part swaps while a list beside it grows and empties', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-card-native>${s.flag ? headA() : headB()}${Array.from({ length: s.n }, (_, i) => em(i))}</cf-card-native>`
      : html`<cf-card-light>${s.flag ? headA() : headB()}${Array.from({ length: s.n }, (_, i) => em(i))}</cf-card-light>`,
  steps: [
    ['A, one', (side) => side.render({ flag: true, n: 1 })],
    ['B, three', (side) => side.render({ flag: false, n: 3 })],
    ['A, none', (side) => side.render({ flag: true, n: 0 })],
  ],
});

scenario('placed content: a keyed list reorders inside a nested component', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-box-native>${s.ks.map((k) => keyed(k, html`<p>${k}</p>`))}</cf-box-native>`
      : html`<cf-box-light>${s.ks.map((k) => keyed(k, html`<p>${k}</p>`))}</cf-box-light>`,
  steps: [
    ['abc', (side) => side.render({ ks: ['a', 'b', 'c'] })],
    ['cab', (side) => side.render({ ks: ['c', 'a', 'b'] })],
    ['b only', (side) => side.render({ ks: ['b'] })],
  ],
});

scenario('placed content: an applier commits during the nested component\'s own render', {
  draw: (s, side) =>
    side.mode === 'native'
      ? html`<cf-fire-native>${later(side, loading())}</cf-fire-native>`
      : html`<cf-fire-light>${later(side, loading())}</cf-fire-light>`,
  steps: [
    ['render', (side) => {
      fireNext = () => side.parts[0]._$commit$(lateSlotted());
      side.render({});
    }],
    ['re-render the outer', (side) => side.render({})],
    ['user adds to the inner', (side) => side.targets[0].firstElementChild.append(el('b', {}, 'late'))],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Nodes the component rendered, later handed to another host by the user — round 2 B (p9, p9b)     */
/* ------------------------------------------------------------------------------------------------ */

scenario('a node the component dropped is appended by the user to another host', {
  hosts: 2,
  draw: (s) => (s.box ? html`<div class="box"><slot>FALLBACK</slot></div>` : html`<p>x</p>${s.node}`),
  steps: [
    ['render with the node', (side) => {
      side.node = el('canvas', {}, 'CANVAS');
      side.render({ node: side.node }, 0);
      side.render({ box: true }, 1);
    }],
    ['dropped by the render', (side) => side.render({ node: null }, 0)],
    ['user appends it to the other host', (side) => side.hosts[1].append(side.node)],
  ],
});

scenario('a row from a top-level list is dragged into another host', {
  hosts: 2,
  draw: (s) => (s.box ? html`<div class="box"><slot>FALLBACK</slot></div>` : html`${s.items.map((i) => html`<li>${i}</li>`)}`),
  steps: [
    ['render', (side) => {
      side.render({ items: ['a', 'b'] }, 0);
      side.render({ box: true }, 1);
    }],
    ['drag row a', (side) => side.hosts[1].append(side.targets[0].querySelector('li'))],
    ['re-render the source', (side) => side.render({ items: ['b'] }, 0)],
  ],
});

/* ------------------------------------------------------------------------------------------------ */
/* Late commits off the page, and during other renders — round 3 A (p6b), B (p14); round 4 A        */
/* ------------------------------------------------------------------------------------------------ */

scenario('an applier resolves on an off-page host, which is attached afterwards', {
  detached: true,
  draw: (s, side) => html`<h1>h</h1>${later(side, loading())}`,
  children: () => [el('b', {}, 'USER')],
  steps: [
    ['render off-page', (side) => side.render({})],
    ['resolve', (side) => side.parts[0]._$commit$(lateSlotted())],
    ['attach', (side) => document.body.append(side.hosts[0])],
  ],
});

scenario('an off-page host is attached, then its applier resolves', {
  detached: true,
  draw: (s, side) => html`<h1>h</h1>${later(side, loading())}`,
  children: () => [el('b', {}, 'USER')],
  steps: [
    ['render off-page', (side) => side.render({})],
    ['attach', (side) => document.body.append(side.hosts[0])],
    ['resolve', (side) => side.parts[0]._$commit$(lateSlotted())],
  ],
});

const innerLater = (side) => html`<div>${later(side, html`<i>inner wait</i>`)}</div>`;
scenario('a nested applier resolves after its host was built off-page and attached', {
  detached: true,
  draw: (s, side) => html`<h1>h</h1>${later(side, loading())}`,
  children: () => [el('b', {}, 'USER')],
  steps: [
    ['render off-page', (side) => side.render({})],
    ['outer resolves off-page', (side) => side.parts[0]._$commit$(innerLater(side))],
    ['attach', (side) => document.body.append(side.hosts[0])],
    ['inner resolves', (side) => side.parts[1]._$commit$(lateSlotted())],
  ],
});

const section = () => html`<section><slot>X-FB</slot></section>`;
const firesDuring = (side) => html`<span &ref=${() => side.parts[0]._$commit$(section())}></span><main><slot>YFB</slot></main>`;
scenario('a removed host\'s applier commits during another host\'s render, then it returns', {
  hosts: 2,
  draw: (s, side) => (s.y ? firesDuring(side) : html`<div>${later(side, loading())}</div>`),
  children: () => [el('b', {}, 'X-USER')],
  steps: [
    ['render X', (side) => side.render({}, 0)],
    ['remove X', (side) => side.hosts[0].remove()],
    ['Y renders, X commits', (side) => { side.hosts[1].append(el('b', {}, 'Y-USER')); side.render({ y: true }, 1); }],
    ['X returns', (side) => side.hosts[1].before(side.hosts[0])],
  ],
});

scenario('a discarded part\'s applier commits during another host\'s render', {
  hosts: 2,
  draw: (s, side) =>
    s.y ? firesDuring(side) : html`${s.a ? html`<div>${later(side, loading())}</div>` : html`<p>other</p>`}`,
  steps: [
    ['X with the applier', (side) => side.render({ a: true }, 0)],
    ['X swaps it out', (side) => side.render({ a: false }, 0)],
    ['Y renders, the stale part commits', (side) => { side.hosts[1].append(el('b', {}, 'Y-USER')); side.render({ y: true }, 1); }],
  ],
});
