/**
 * **The renderer's per-render state, and the slots/namespaces contracts that ride on it.**
 *
 * Every case here was a defect found by the 2026-09-27 audit of the contextual-namespace branch, and
 * each is pinned against a control that shows the same code path doing the right thing:
 *
 * - `renderInto` owns the render root and the create scope, saving and restoring both. A render that
 *   threw inside an SVG template's first update left the scope set for the rest of the page (every
 *   later shadow component built as SVG); a render reached from inside another — a ref portal — read
 *   the OUTER scope and root, building HTML as SVG and crashing slots on a null root.
 * - `hold()` restores an instance live, so a shape change during the restore resolves where it is.
 * - Under a MathML parent the parser's answer depends on the tag, and the namespaces module asks with it.
 * - With slots wired, a component's own top-level `${…}` is the render's own output, not content.
 * - Slots sets its instance hook first (priority 10), so a later consumer finds it and wraps it.
 * - An older slots module (no `$o`) beside this renderer is treated as unwired, not given the host.
 * - A self-closed tag in an `html` template used only inside `<svg>` is not warned about.
 * - The namespace cache on a parent element is invisible to `Object.keys`.
 *
 * The retained-component finding (the per-fill memo holding a shadow root) needs forced collection to
 * observe, which this suite deliberately never uses; it was measured with `--expose-gc` probes.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, html } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { namespaces } = await load('renderer/namespaces');
const { slots } = await load('renderer/slots');
const doc = dom.window.document;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const SVG = 'http://www.w3.org/2000/svg';
const MATH = 'http://www.w3.org/1998/Math/MathML';
const XHTML = 'http://www.w3.org/1999/xhtml';

/**
 * A third-party instance hook after slots, written as `InstanceHook` asks: it WRAPS the
 * hook it finds — slots', which runs first at priority 10 — carrying both states as a pair.
 */
const calls = { c: 0, m: 0, q: 0 };
const counting = {
  name: 'counting',
  on: 'template',
  /** Not 50: a taken priority REPLACES its registrant, and namespaces holds 50 on this chain. */
  priority: 55,
  fn: (built, result) => {
    if (!result.strings.join('').includes('data-counted')) return;
    const inner = built._$inst$;
    built._$inst$ = {
      $c: (fragment, root) => (calls.c++, [inner?.$c(fragment, root), 'state']),
      $m: ([state], root) => (calls.m++, [state === undefined ? undefined : inner.$m(state, root), 'kept']),
      $q: ([kept]) => {
        calls.q++;
        if (kept !== undefined) inner.$q(kept);
      },
    };
  },
};
wire([renderer, namespaces, slots, counting]);

const card = () => html`<button>ok</button>`;
const shadowButton = () => {
  const host = doc.createElement('div');
  doc.body.append(host);
  const root = host.attachShadow({ mode: 'open' });
  renderInto(card(), root);
  return root.querySelector('button').namespaceURI;
};

test('a render that throws inside an SVG template leaves no SVG scope behind for the rest of the page', () => {
  assert.equal(shadowButton(), XHTML, 'CONTROL: a shadow component builds HTML before anything threw');
  function* points(data) {
    for (const d of data) {
      if (d == null) throw new Error('bad datum');
      yield html`<circle r=${d}></circle>`;
    }
  }
  const series = (c) => html`<g>${c}</g>`;
  const chart = (c) => html`<svg>${c}</svg>`;
  assert.throws(() => renderInto(chart(series(points([1, null]))), doc.createElement('div')), /bad datum/);
  assert.equal(shadowButton(), XHTML, 'after the throw, a shadow component still builds HTML');
  const fragment = doc.createDocumentFragment();
  renderInto(card(), fragment);
  assert.equal(fragment.querySelector('button').namespaceURI, XHTML, 'and so does a fragment render');
});

test('a render reached from inside another — a ref portal — builds in its own container, not the outer one', () => {
  const tip = () => html`<button>tooltip</button>`;
  const portal = (el) => {
    if (el === null) return;
    const fragment = doc.createDocumentFragment();
    renderInto(tip(), fragment);
    doc.body.append(fragment);
  };
  const fromHtml = () => html`<span ${portal}></span>`;
  renderInto(fromHtml(), doc.createElement('div'));
  const control = doc.body.lastElementChild;
  assert.equal(control.namespaceURI, XHTML, 'CONTROL: a portal from an HTML element builds HTML');
  control.remove();
  const shape = () => html`<circle r="4" ${portal}></circle>`;
  const chart = (c) => html`<svg>${c}</svg>`;
  renderInto(chart(shape()), doc.createElement('div'));
  assert.equal(doc.body.lastElementChild.localName, 'button');
  assert.equal(doc.body.lastElementChild.namespaceURI, XHTML, 'a portal from inside an <svg> builds HTML too');
  doc.body.lastElementChild.remove();
});

test('a nested render during a slotted template\'s first update keeps the outer render\'s root', async () => {
  const tip = () => html`<span>tip</span>`;
  const onRef = (el) => { if (el !== null) renderInto(tip(), el); };
  const draw = () => html`<header><i ${onRef}></i><slot name="h">fallback</slot></header>`;
  const host = doc.createElement('div');
  host.innerHTML = '<b slot="h">MINE</b>';
  doc.body.append(host);
  renderInto(draw(), host);
  await settle();
  assert.equal(host.querySelector('i').textContent, 'tip', 'CONTROL: the nested render ran');
  assert.equal(host.querySelector('header b')?.textContent, 'MINE', 'and the outer slot still took its content');
  host.remove();
});

test('hold() restores an instance live, so a shape changed during the restore lands in the right namespace', () => {
  const dot = () => html`<circle r="3"></circle>`;
  const box = () => html`<rect width="3"></rect>`;
  const a = (inner) => html`${inner}<line></line>`;
  const b = () => html`<ellipse></ellipse>`;
  const draw = (v) => html`<svg>${hold(v)}</svg>`;
  const shapes = (host) => [...host.querySelector('svg').children].map((e) => `${e.localName}:${e.namespaceURI === SVG ? 'svg' : 'other'}`).join(' ');
  const control = doc.createElement('div');
  renderInto(draw(a(dot())), control);
  renderInto(draw(a(box())), control);
  assert.equal(shapes(control), 'rect:svg line:svg', 'CONTROL: the same change in place');
  const host = doc.createElement('div');
  renderInto(draw(a(dot())), host);
  renderInto(draw(b()), host);
  renderInto(draw(a(box())), host);
  assert.equal(shapes(host), 'rect:svg line:svg', 'the restored instance builds its new shape as SVG');
});

test('under a MathML parent the namespace follows the tag, as the parser decides it', () => {
  const parsed = doc.createElement('div');
  parsed.innerHTML = '<math><annotation-xml><svg></svg></annotation-xml><mi><mglyph></mglyph></mi><mi><b></b></mi></math>';
  const [pSvg, pGlyph, pB] = [parsed.querySelector('svg'), parsed.querySelector('mglyph'), parsed.querySelector('b')];
  const pic = () => html`<svg><circle r="1"></circle></svg>`;
  const glyph = () => html`<mglyph></mglyph>`;
  const bold = () => html`<b>x</b>`;
  const view = () => html`<math><annotation-xml>${pic()}</annotation-xml><mi>${glyph()}</mi><mi>${bold()}</mi></math>`;
  const rendered = doc.createElement('div');
  renderInto(view(), rendered);
  assert.equal(rendered.querySelector('svg').namespaceURI, pSvg.namespaceURI, '<svg> inside <annotation-xml>');
  assert.equal(rendered.querySelector('circle').namespaceURI, SVG);
  assert.equal(rendered.querySelector('mglyph').namespaceURI, pGlyph.namespaceURI, '<mglyph> inside <mi>');
  assert.equal(rendered.querySelector('b').namespaceURI, pB.namespaceURI, 'CONTROL: any other tag inside <mi> is HTML');
  assert.equal(pGlyph.namespaceURI, MATH, 'CONTROL: the parser really does keep <mglyph> MathML there');
});

test('with slots wired, a light component\'s own top-level ${…} is its output, not content to capture', async () => {
  const loading = () => html`<p class="spinner">loading…</p>`;
  const list = () => html`<ul><li>one</li></ul>`;
  const draw = (busy) => html`${busy ? loading() : list()}`;
  const host = doc.createElement('my-list');
  doc.body.append(host);
  renderInto(draw(true), host);
  assert.equal(host.textContent, 'loading…', 'CONTROL: the first render shows');
  renderInto(draw(false), host);
  await settle();
  assert.equal(host.textContent, 'one', 'the switch shows the list');
  const row = (i) => html`<li>${i}</li>`;
  const rows = (n) => html`${Array.from({ length: n }, (_, i) => row(i))}`;
  const other = doc.createElement('my-rows');
  doc.body.append(other);
  renderInto(rows(1), other);
  renderInto(rows(3), other);
  await settle();
  assert.equal(other.querySelectorAll('li').length, 3, 'a top-level list grows to every row');
  host.remove();
  other.remove();
});

test('a hook wired after slots finds slots\' instance hook and wraps it: both run', async () => {
  calls.c = calls.m = calls.q = 0;
  const draw = () => html`<section data-counted><slot>fb</slot></section>`;
  const host = doc.createElement('div');
  host.innerHTML = '<b>CONTENT</b>';
  doc.body.append(host);
  renderInto(draw(), host);
  await settle();
  assert.equal(host.querySelector('section').textContent, 'CONTENT', 'slots distributed');
  assert.deepEqual([calls.c, calls.m], [1, 1], 'and the other hook ran its create and mount');
  renderInto(html`<p>gone</p>`, host);
  assert.equal(calls.q, 1, 'and its teardown');
  host.remove();
});

test('the namespace cache on a parent element does not show in Object.keys', () => {
  const svg = doc.createElementNS(SVG, 'svg');
  renderInto(html`<circle r="1"></circle>`, svg);
  assert.equal(svg.firstElementChild?.namespaceURI ?? svg.querySelector('circle').namespaceURI, SVG, 'CONTROL: it was asked');
  assert.deepEqual(Object.keys(svg), []);
});

test('a self-closed tag in an html template used only inside <svg> is not warned about', { skip: isProduction }, () => {
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    const frame = (c) => html`<svg viewBox="0 0 24 24">${c}</svg>`;
    const icon = () => html`<path d="M0 0h24" /><circle r="2" />`;
    const host = doc.createElement('div');
    renderInto(frame(icon()), host);
    assert.equal(host.querySelector('svg > circle')?.namespaceURI, SVG, 'CONTROL: drawn as siblings, in SVG');
    const open = () => html`<div><span /><b>after</b></div>`;
    renderInto(open(), doc.createElement('div'));
  } finally {
    console.warn = original;
  }
  const leftOpen = said.filter((m) => m.includes('is left OPEN'));
  assert.equal(leftOpen.length, 1, `only the HTML use is warned about: ${JSON.stringify(leftOpen)}`);
  assert.match(leftOpen[0], /^\[vera\] renderer: <span>/);
});

test('a hook wired BEFORE slots is replaced, and development says so', { skip: isProduction }, async () => {
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    wire([{ name: 'too-early', on: 'template', priority: 5, fn: (built, result) => {
      if (result.strings.join('').includes('data-early')) built._$inst$ = { $c: () => undefined, $m: () => undefined, $q: () => {} };
    } }]);
    const host = doc.createElement('div');
    host.innerHTML = '<b>MINE</b>';
    doc.body.append(host);
    renderInto(html`<section data-early><slot>fb</slot></section>`, host);
    await settle();
    assert.equal(host.querySelector('section').textContent, 'MINE', 'CONTROL: slots still distributes');
    host.remove();
  } finally {
    console.warn = original;
  }
  assert.equal(said.filter((m) => m.includes('before `slotDiscovery`')).length, 1, JSON.stringify(said));
});

/**
 * Round 2: the render's own output is decided by WHERE it is inserted during a render, not by a stamp
 * on a marker — markers created live, and rows a keyed list batches, never carried one.
 */
test("with slots wired, a component's own content stays its own on every live path", async () => {
  const host = (tag) => {
    const element = doc.createElement(tag);
    element.innerHTML = '<b>USER</b>';
    doc.body.append(element);
    return element;
  };
  const shell = (rest) => html`<main><slot>fb</slot></main>${rest}`;
  const error = () => html`<p class="error">failed</p>`;
  const a = host('x-empty');
  renderInto(shell(''), a);
  renderInto(shell(error()), a);
  await settle();
  assert.ok(a.querySelector(':scope > p.error'), "an empty string's part upgrading to a template shows it");
  assert.equal(a.querySelector('main').textContent, 'USER', 'CONTROL: the user content is in the slot');
  const row = (i) => html`<li>${i}</li>`;
  const { keyed } = await load('renderer/keyed');
  const rows = (n) => Array.from({ length: n }, (_, i) => keyed(i, row(i)));
  const b = host('x-keyed');
  renderInto(shell(rows(1)), b);
  renderInto(shell(rows(3)), b);
  await settle();
  assert.equal(b.querySelectorAll(':scope > li').length, 3, 'a keyed list growing by two keeps its rows');
  assert.equal(b.querySelector('main').textContent, 'USER', 'and the slot got none of them');
  const shaped = (i, em) => (em ? html`<em>${i}</em>` : html`<li>${i}</li>`);
  const c = host('x-shape');
  renderInto(shell([1, 2].map((i) => shaped(i, false))), c);
  renderInto(shell([1, 2].map((i) => shaped(i, i === 2))), c);
  await settle();
  assert.ok(c.querySelector(':scope > em'), 'a row changing shape stays in place');
  assert.equal(c.querySelector('main').textContent, 'USER');
  for (const element of [a, b, c]) element.remove();
});

/**
 * A commit AFTER the render returned — a child applier resolving later, the `until()` pattern — runs
 * as a render of the container that attached it: a `<slot>` it commits distributes, and a `<select>`
 * value it commits is applied.
 */
test('an applier committing later distributes its slots and applies its select values', async () => {
  const body = () => html`<section><slot name="h">FALLBACK</slot></section>`;
  const applyLater = (part) => void Promise.resolve().then(() => part._$commit$(body()));
  const later = { _$child$: applyLater };
  const host = doc.createElement('x-later');
  host.innerHTML = '<b slot="h">MINE</b>';
  doc.body.append(host);
  renderInto(html`<article>${later}</article>`, host);
  await settle();
  await settle();
  assert.equal(host.querySelector('section').textContent, 'MINE', 'the late <slot> took the host content');
  const picker = (v) => html`<select .value=${v}><option>a</option><option>b</option><option>c</option></select>`;
  const applySelect = (part) => void Promise.resolve().then(() => part._$commit$(picker('c')));
  const box = doc.createElement('div');
  doc.body.append(box);
  renderInto(html`<div>${{ _$child$: applySelect }}</div>`, box);
  await settle();
  await settle();
  assert.equal(box.querySelector('select').value, 'c', 'the late select value was applied');
  host.remove();
  box.remove();
});
