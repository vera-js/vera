/**
 * **Light-DOM slots hydrated from real server output, compared step by step with a client render.**
 *
 * The client-side conformance suite (`tests/browser/slots-conformance.test.js`) holds light slots to
 * native shadow DOM. This holds HYDRATION to the client: a component is rendered by `@verajs/ssr`,
 * hydrated from that markup, and put through the same steps as the same component rendered on the
 * client with the same children — and what the host shows must match after every step, with element
 * identity compared too (a hydrated node re-created is a lost focus or a lost typed value).
 *
 * The oracle is the client render because hydration's promise is exactly that: indistinguishable from
 * having rendered on the client. Each scenario is one template SOURCE, written once and used by both
 * sides — the server module and the client's draw function are built from the same string, so they
 * cannot drift. Scenarios are the auditors' hydration probes (round 3 B1, B4/B5, B7, B8, B9, and the
 * client-only node), plus the one no probe covered: named and default content interleaved in the light
 * tree, whose cross-slot ORDER the server's markup has never recorded.
 *
 * KNOWN works as in the client suite: an entry asserts its scenario still diverges, so fixing one turns
 * this red until it comes off the list.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dir = mkdtempSync(join(process.cwd(), 'tests', '.hydrate-conformance-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment',
  'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver', 'Comment', 'Text',
  'HTMLTemplateElement', 'NodeFilter', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

const core = await load('core');
const hydrating = await load('renderer/hydrate');
const base = await load('renderer');
const { slots } = await load('renderer/slots');
const { keyed } = await load('renderer/keyed');
core.wire([hydrating.renderer, slots]);
/**
 * The base renderer is a separate bundle from the hydrating one, with its own reference to the
 * registry — handed over by its `connect`, which only runs for a wired module. The client-side
 * control renders through it, so it is connected too (not registered: one renderer per page).
 */
core.wire([(registry) => base.renderer.connect(registry)]);
const { html } = core;

/** A template source is the body of `html\`…\`` with `S` in scope — one string, both sides. */
const drawFrom = (source) => new Function('html', 'keyed', 'S', `return html\`${source}\`;`).bind(null, html, keyed);

/** Server-renders `<tag>children</tag>` for a component whose template is `source` at `state`. */
const serve = (name, tag, source, state, children, extra = '') => {
  const file = join(dir, `${name}.js`);
  writeFileSync(
    file,
    `import { init, render, html } from '@verajs/core';\nimport { keyed } from '@verajs/renderer/keyed';\n${extra}\n` +
      `const S = ${JSON.stringify(state)};\n` +
      `customElements.define('${tag}', class extends HTMLElement { connectedCallback() { init(this); render(() => html\`${source}\`); } });\n`
  );
  const script =
    `import { renderToString } from '@verajs/ssr';\nimport { wire } from '@verajs/core';\n` +
    `const { slots } = await import('@verajs/renderer/slots'); wire([slots]);\n` +
    `process.stdout.write((await renderToString(new URL('file://${file}'), { tag: '${tag}', children: ${JSON.stringify(children)} })).html);`;
  return execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
};

/** What the host shows, comments skipped, text merged, elements numbered by first appearance. */
const viewer = () => {
  const ids = new Map();
  return (host) => {
    let out = '';
    let text = '';
    const flush = () => {
      if (text !== '') out += JSON.stringify(text);
      text = '';
    };
    const walk = (node) => {
      if (node.nodeType === 3) return void (text += node.data);
      if (node.nodeType !== 1) return;
      if (node.localName === 'template') return;
      flush();
      if (!ids.has(node)) ids.set(node, ids.size + 1);
      const attrs = [...node.attributes].filter((a) => !a.name.startsWith('data-vm-')).map((a) => ` ${a.name}="${a.value}"`).sort().join('');
      out += `<${node.localName}#${ids.get(node)}${attrs}>`;
      for (const child of node.childNodes) walk(child);
      flush();
      out += `</${node.localName}>`;
    };
    for (const child of host.childNodes) walk(child);
    flush();
    return out;
  };
};

let count = 0;
/**
 * One scenario, both ways. `steps` are `[label, (side) => …]`; `side.render(state)` renders the
 * component's template (the hydrating renderer adopts the first time), `side.host` is the host.
 */
const run = async ({ source, state, children, steps, inner }) => {
  const n = ++count;
  const tag = `hc-host-${n}`;
  const innerTag = inner ? `hc-inner-${n}` : null;
  const outerSource = inner ? source.replaceAll('INNER', innerTag) : source;
  const extra = inner
    ? `customElements.define('${innerTag}', class extends HTMLElement { connectedCallback() { init(this); render(() => html\`${inner}\`); } });`
    : '';
  const serverHtml = serve(`s${n}`, tag, outerSource, state, children, extra);
  const draw = drawFrom(outerSource);
  const drawInner = inner ? drawFrom(inner) : null;
  const sides = {};
  for (const mode of ['client', 'hydrated']) {
    const wrap = doc.createElement('div');
    wrap.innerHTML = mode === 'hydrated' ? serverHtml : `<${tag}>${children}</${tag}>`;
    const host = wrap.firstElementChild;
    doc.body.append(host);
    const renderInto = mode === 'hydrated' ? hydrating.renderInto : base.renderInto;
    const warned = [];
    const warn = console.warn;
    console.warn = (...args) => warned.push(args.join(' '));
    const side = {
      host,
      view: viewer(),
      render: (s) => {
        renderInto(draw(s), host);
        if (drawInner) renderInto(drawInner({}), host.querySelector(innerTag));
      },
      trace: [],
    };
    for (const [label, step] of steps) {
      try {
        await step(side);
        await settle();
        side.trace.push(`${label}: ${side.view(host)}`);
      } catch (error) {
        side.trace.push(`${label}: THREW ${error.message}`);
      }
    }
    console.warn = warn;
    host.remove();
    sides[mode] = side.trace;
    sides[`${mode}Warned`] = warned;
  }
  return sides;
};

/** name → what diverges, filled from what the suite measures. */
const KNOWN = new Map([]);

const scenario = (name, spec) =>
  test(name, async () => {
    const { client, hydrated, hydratedWarned } = await run(spec);
    assert.ok(client.every((line) => !line.includes('THREW')), `CONTROL: the client render never throws: ${client}`);
    /**
     * A fallback to a client render would pass the view comparison — it IS a client render — so
     * adoption is asserted separately: the hydrating renderer reports every fallback in development.
     */
    if (!isProduction && !KNOWN.has(name))
      assert.deepEqual(hydratedWarned.filter((line) => line.includes('fell back')), [], 'hydration adopted rather than falling back');
    const known = KNOWN.get(name);
    if (known === undefined) assert.deepEqual(hydrated, client);
    else assert.notDeepEqual(hydrated, client, `KNOWN divergence (${known}) now CONFORMS — take it off KNOWN`);
  });

test('CONTROL: a fallback is visible to the adoption check', { skip: isProduction && 'the warning is development-only' }, () => {
  const host = doc.createElement('div');
  host.innerHTML = '<p>not what the template says</p>';
  doc.body.append(host);
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    hydrating.renderInto(drawFrom('<main>${S}</main>')('x'), host);
  } finally {
    console.warn = warn;
  }
  host.remove();
  assert.ok(warned.some((line) => line.includes('fell back')), `a mismatch is reported: ${warned}`);
});

const text = (host, value) => host.ownerDocument.createTextNode(value);
const el = (host, tag, attrs = {}, content = '') => {
  const node = host.ownerDocument.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.textContent = content;
  return node;
};

scenario('a hydrated host reorders its own top-level keyed list, and its slot keeps the user\'s node', {
  source: '<div class="box"><slot>FB</slot></div>${S.order.map((n) => keyed(n, html`<p>row ${n}</p>`))}',
  state: { order: [1, 2, 3] },
  children: '<b>USER</b>',
  steps: [
    ['hydrate', (side) => side.render({ order: [1, 2, 3] })],
    ['reorder', (side) => side.render({ order: [3, 1, 2] })],
    ['grow', (side) => side.render({ order: [3, 1, 2, 4] })],
  ],
});

scenario('content appended to a hydrated host before its slot mounts is distributed when it does', {
  source: '<header>HEAD</header>${S.on ? html`<div class="body"><slot>none</slot></div>` : ""}<footer>FOOT</footer>',
  state: { on: false },
  children: '<b>SERVER-CHILD</b>',
  steps: [
    ['hydrate', (side) => side.render({ on: false })],
    ['user appends', (side) => side.host.append(el(side.host, 'i', {}, 'APPENDED'))],
    ['slot mounts', (side) => side.render({ on: true })],
  ],
});

scenario('a client-only node the component renders after its slot stays the component\'s own', {
  source: '<div class="box"><slot>FB</slot></div>${S.icon ? html`<i>ICON</i>` : ""}',
  state: { icon: false },
  children: '<b>MINE</b>',
  steps: [
    ['hydrate', (side) => side.render({ icon: false })],
    ['icon appears', (side) => side.render({ icon: true })],
    ['user appends', (side) => side.host.append(el(side.host, 'u', {}, 'LATE'))],
  ],
});

scenario('a hydrated root swapped for one with a slot, then content prepended', {
  source: '${S.swap ? html`<section class="box"><slot>FB2</slot></section>` : html`<div class="box"><slot>FB</slot></div>`}',
  state: { swap: false },
  children: '<b>A</b>',
  steps: [
    ['hydrate', (side) => side.render({ swap: false })],
    ['swap', (side) => side.render({ swap: true })],
    ['prepend', (side) => side.host.prepend(el(side.host, 'i', {}, 'P'))],
  ],
});

scenario('named and default content interleaved in the light tree keeps its order through a re-slot', {
  source: '<header><slot name="h">no-h</slot></header><main><slot>no-d</slot></main>',
  state: {},
  children: '<b slot="h">H1</b>t1<b slot="h">H2</b>t2',
  steps: [
    ['hydrate', (side) => side.render({})],
    ['re-slot H1 to default', (side) => side.host.querySelector('b').setAttribute('slot', '')],
    ['re-slot it back', (side) => side.host.querySelector('main b').setAttribute('slot', 'h')],
  ],
});

scenario('a hydrated user node removed brings the fallback back; re-added, it returns', {
  source: '<main><slot>fallback</slot></main>',
  state: {},
  children: '<b>ONE</b>',
  steps: [
    ['hydrate', (side) => side.render({})],
    ['user removes', (side) => { side.removed = side.host.querySelector('b'); side.removed.remove(); }],
    ['user re-adds', (side) => side.host.append(side.removed)],
  ],
});

scenario('content parked by the server for a slot that appears later', {
  source: '<header><slot name="h">no-h</slot></header>${S.aside ? html`<aside><slot name="later">none</slot></aside>` : ""}',
  state: { aside: false },
  children: '<b slot="h">H</b><i slot="later">LATER</i>',
  steps: [
    ['hydrate', (side) => side.render({ aside: false })],
    ['the slot appears', (side) => side.render({ aside: true })],
  ],
});

scenario('a light component nested in another\'s template hydrates, and the outer updates what it placed', {
  source: '<div class="o"><slot>OFB</slot></div><INNER><b>${S.v}</b></INNER>',
  inner: '<div class="box"><slot>FB</slot></div>',
  state: { v: 'X' },
  children: '<i>OUTER-CHILD</i>',
  steps: [
    ['hydrate', (side) => side.render({ v: 'X' })],
    ['outer updates', (side) => side.render({ v: 'Y' })],
  ],
});
