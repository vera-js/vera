/**
 * **`foreignNodes` — step 1: a SHADOW component root the template owns** (Brian, 2026-10-16). Foreign nodes are nodes
 * placed in a component's root by anything other than its own template. `'drop'` (the default for a component's root):
 * no marker comments when the root is empty at its first render; an ordinary re-render touches nothing it did not render;
 * a template CHANGE clears the root, foreign nodes included — and development says so, once. `'preserve'` (the
 * component's own, or `renderer({ foreignNodes })`): the markered root and its positional contract. A container handed to
 * `renderInto` directly always preserves — the app default sets COMPONENT roots only. Light component roots stay
 * markered until step 3; a non-empty shadow root (declarative, or holding styles' text fallback) stays markered.
 *
 * **Order matters here:** `foreign-dropped` is said once per PAGE, so a row asserting that something is NOT said must run
 * before the first row that triggers it — after it, the row passes by silence (two mutations measured nothing that way).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame', 'ShadowRoot'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { init, html, wire, inserts, ref, flush } = core;
const doc = dom.window.document;
const COMMENT = 8;
const comments = (root) => [...root.childNodes].filter((node) => node.nodeType === COMMENT).length;
let seq = 0;
const listen = async (run) => {
  const said = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = (...a) => said.push(`warn ${a.join(' ')}`);
  console.error = (...a) => said.push(`error ${a.join(' ')}`);
  try { await run(); } finally { Object.assign(console, saved); }
  return said;
};

wire([renderer]);

/**
 * A shadow component drawing ONE of two templates through one draw function (two template literals are two templates —
 * so `which` switches the template, and `n` changes a value in the same one). `options` are the component's own.
 */
const mount = (options = {}) => {
  const tag = `x-foreign-${seq++}`;
  const state = ref({ which: 'a', n: 0 });
  const draw = () => (state.value.which === 'a' ? html`<p>a ${state.value.n}</p>` : html`<b>b ${state.value.n}</b>`);
  customElements.define(tag, class extends HTMLElement { connectedCallback() { init({ host: this, shadow: 'open', ...options }, () => draw); } });
  const el = doc.createElement(tag);
  doc.body.append(el);
  flush();
  return { el, root: el.shadowRoot, state };
};
const stray = () => {
  const node = doc.createElement('ext-badge');
  node.textContent = 'ext';
  return node;
};

test("'drop' (the default): a shadow root empty at its first render carries no marker comments", () => {
  const { root } = mount();
  assert.equal(comments(root), 0, root.innerHTML);
  assert.equal(root.textContent, 'a 0');
});

/** FIRST of the warning rows: the warning is said once per page, so after any row that triggers it, this one would pass by silence. */
test("'drop': the template's OWN nodes are never called foreign — a render-only template change says nothing", async () => {
  const { root, state } = mount();
  const said = await listen(async () => {
    for (const which of ['b', 'a', 'b']) {
      state.value = { which, n: 2 };
      flush();
    }
  });
  assert.deepEqual(said, []);
  assert.equal(root.textContent, 'b 2');
});

/** Also before the first warning, for the same reason. */
test("a re-added 'drop' component keeps what its RE-INIT put in the root (styles' fallback in a second window) — only the released content is cleared", async () => {
  const { el, root } = mount();
  assert.equal(comments(root), 0, 'CONTROL: the root is owned');
  const before = root.querySelector('p');
  let reinit = false;
  /** What styles does in a window that cannot adopt the opener's sheet: a `<style>` appended at init, before the render. */
  const placed = [];
  wire([{ on: 'init', priority: 50, fn: (element) => { if (reinit && element === el) placed.push(element.shadowRoot.appendChild(doc.createElement('style'))); } }]);
  el.remove();
  flush();
  reinit = true;
  const said = await listen(async () => {
    doc.body.append(el);
    flush();
  });
  assert.equal(placed.length, 1, 'CONTROL: the re-init ran the init insert');
  assert.ok(placed[0].parentNode === root, 'the re-init\'s <style> survived the re-add');
  assert.equal(root.querySelectorAll('p').length, 1, root.innerHTML);
  assert.ok(root.querySelector('p') !== before, 'rendered FRESH — the released content was cleared, not left standing');
  assert.equal(root.textContent, 'a 0');
  assert.deepEqual(said, [], 'nothing reported: no error, and nothing it kept called dropped');
  reinit = false;
});

test("'drop': a foreign node survives an ordinary re-render and goes on a template change — development says so once, production silently", async () => {
  const { root, state } = mount();
  const ext = stray();
  root.append(ext);
  const first = await listen(async () => {
    state.value = { which: 'a', n: 1 };
    flush();
  });
  assert.ok(ext.parentNode === root, 'an ordinary re-render left it');
  assert.equal(root.querySelector('p').textContent, 'a 1');
  assert.deepEqual(first, [], 'nothing to say yet');
  const said = await listen(async () => {
    state.value = { which: 'b', n: 1 };
    flush();
  });
  assert.ok(ext.parentNode === null, 'the template change cleared it');
  assert.equal(root.textContent, 'b 1');
  if (isProduction) assert.deepEqual(said, [], 'production removes it silently');
  else {
    assert.equal(said.length, 1, said.join(' | '));
    assert.ok(said[0].includes('[vera]') && said[0].includes('foreign-dropped') && said[0].includes('<ext-badge>'), said[0]);
  }
});

test("'preserve' on the component: the markered root — a foreign node beside the template survives a template change, in place", () => {
  const { root, state } = mount({ foreignNodes: 'preserve' });
  assert.equal(comments(root), 2, root.innerHTML);
  const ext = stray();
  root.prepend(ext);
  state.value = { which: 'b', n: 0 };
  flush();
  assert.ok(root.firstChild === ext, 'still first');
  assert.equal(root.querySelector('b').textContent, 'b 0');
});

test("renderer({ foreignNodes: 'preserve' }) is the app default, and a component's own 'drop' beats it", () => {
  wire([renderer({ foreignNodes: 'preserve' })]);
  try {
    const kept = mount();
    assert.equal(comments(kept.root), 2, 'the default preserves');
    const own = mount({ foreignNodes: 'drop' });
    assert.equal(comments(own.root), 0, "the component's own wins");
  } finally {
    inserts.$F = undefined;
  }
});

test("the app default is COMPONENT-scoped: a container handed to renderInto keeps its markers and its foreign nodes, whatever the default says", () => {
  wire([renderer({ foreignNodes: 'drop' })]);
  try {
    const app = doc.createElement('div');
    doc.body.append(app);
    const draw = (which) => (which ? html`<p>one</p>` : html`<b>two</b>`);
    renderInto(draw(true), app);
    assert.equal(comments(app), 2, 'markered');
    const ext = stray();
    app.append(ext);
    renderInto(draw(false), app);
    assert.ok(ext.parentNode === app, 'survives a template change');
    /** A shadow root handed to renderInto directly is a container too. */
    const host = doc.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    renderInto(draw(true), shadow);
    assert.equal(comments(shadow), 2, 'a direct shadow root is a container');
  } finally {
    inserts.$F = undefined;
  }
});

test('a shadow root NOT empty at its first render stays markered (a declarative root, a styles text fallback)', () => {
  const tag = `x-foreign-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { init({ host: this, shadow: 'open' }, () => () => html`<p>x</p>`); } });
  const el = doc.createElement(tag);
  /** What a declarative root or styles' text fallback leaves before the first render: content already there. */
  el.attachShadow({ mode: 'open' }).append(doc.createElement('style'));
  doc.body.append(el);
  flush();
  assert.equal(comments(el.shadowRoot), 2, el.shadowRoot.innerHTML);
  assert.ok(el.shadowRoot.firstChild.localName === 'style', 'what was there stays first');
});

test('light component roots stay markered in step 1', () => {
  const tag = `x-foreign-${seq++}`;
  customElements.define(tag, class extends HTMLElement { connectedCallback() { init({ host: this }, () => () => html`<p>l</p>`); } });
  const el = doc.createElement(tag);
  doc.body.append(el);
  flush();
  assert.equal(comments(el), 2, el.innerHTML);
});

test("a removed and re-added 'drop' component renders once, fresh, with no markers and no second copy", () => {
  const { el, root } = mount();
  const before = root.querySelector('p');
  el.remove();
  flush();
  doc.body.append(el);
  flush();
  assert.equal(root.querySelectorAll('p').length, 1, root.innerHTML);
  assert.ok(root.querySelector('p') !== before, 'fresh, not the released content left standing');
  assert.equal(comments(root), 0);
  assert.equal(root.textContent, 'a 0');
});

test('an invalid foreignNodes is named in development — own and default — and the template owns the root', async () => {
  let own;
  const said = await listen(async () => {
    own = mount({ foreignNodes: 'keep' });
  });
  assert.equal(comments(own.root), 0, 'the default, drop');
  if (!isProduction) assert.ok(said.some((line) => line.includes('foreign-nodes-option') && line.includes("'keep'")), said.join(' | '));
  wire([renderer({ foreignNodes: true })]);
  try {
    const twice = await listen(async () => {
      mount();
      mount();
    });
    if (!isProduction) assert.equal(twice.filter((line) => line.includes('foreign-nodes-option')).length, 1, `once: ${twice.join(' | ')}`);
  } finally {
    inserts.$F = undefined;
  }
});
