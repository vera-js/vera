/**
 * **`multiWindow`** (`@verajs/renderer/multi-window`, 2026-10-26) on core's `'adopted'` and `'init'` points, and styles on
 * `'adopted'`. Run against the BUILT bundles in both builds: the production pass is the cross-bundle one (each `.min.js`
 * separate code), so a module registering anywhere but core's registry would release nothing there (vera-5a). A window's
 * final `pagehide` is dispatched on a jsdom iframe's window (the real engines' close is in `tests/browser/r4-cross-window`).
 * Counts are exact, each with a control that the counted thing ran.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { distUrl, isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const core = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const { multiWindow } = await load('renderer/multi-window');
core.wire([renderer, styles, multiWindow]);
const { define, html, createStore, effect, flush } = core;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { flush(); await wait(0); flush(); };
const frame = async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  await wait(0);
  return f;
};
/** The window's FINAL hide (not persisted), as a closing pop-out or a removed iframe fires it; then this realm's next task. */
const die = async (view) => { view.dispatchEvent(new view.Event('pagehide')); await wait(10); };

test("a component MOVED into another window's document is released at that window's final pagehide — core's registry heard multiWindow", async () => {
  let cleans = 0, renders = 0;
  const s = createStore({ n: 1 });
  define('x-mw-moved', () => { effect(() => () => cleans++); return () => (renders++, html`<b>${s.n}</b>`); });
  const el = document.createElement('x-mw-moved');
  document.body.append(el);
  await settle();
  const f = await frame();
  f.contentDocument.body.append(el);
  await settle();
  const moved = cleans;
  assert.equal(el.ownerDocument === f.contentDocument && renders >= 1, true, 'CONTROL: it moved and rendered');
  await die(f.contentWindow);
  const before = renders;
  s.n = 2;
  await settle();
  assert.deepEqual([cleans - moved, renders - before], [1, 0], 'released: its cleanup ran once, and a write wakes it no more');
  f.remove();
});

test('a component APPENDED directly into another window (never moved) is released too (the init watch)', async () => {
  let cleans = 0;
  define('x-mw-direct', () => { effect(() => () => cleans++); return () => html`<i></i>`; });
  const f = await frame();
  f.contentDocument.body.append(document.createElement('x-mw-direct'));
  await settle();
  assert.equal(f.contentDocument.querySelector('x-mw-direct i') !== null, true, 'CONTROL: set up there');
  await die(f.contentWindow);
  assert.equal(cleans, 1);
  f.remove();
});

test("styles re-applies through 'adopted' when a component moves into another document (it left the one-off $rs hook)", async () => {
  customElements.define('x-mw-styled', class extends HTMLElement {
    static styles = 'b { color: rgb(1, 2, 3); }';
    connectedCallback() { core.init({ host: this, shadow: 'open' }, () => () => html`<b>s</b>`); }
  });
  const el = document.createElement('x-mw-styled');
  document.body.append(el);
  await settle();
  const sheet = () => el.shadowRoot.querySelector('style[data-vm-sheet="styles"]');
  assert.equal(sheet() !== null, true, 'CONTROL: styled at setup');
  sheet().remove();
  const f = await frame();
  f.contentDocument.body.append(el);
  await settle();
  assert.match(sheet()?.textContent ?? '', /rgb\(1, 2, 3\)/, "re-styled by the 'adopted' chain");
  el.remove();
  f.remove();
});

test('TWO copies of core on one page: each retires only its OWN components (the per-copy mark, $m)', { skip: !isProduction && 'two copies share one registry in development (core keeps inserts external there)' }, async () => {
  const other = await import(distUrl('core', '?copy=2'));
  assert.equal(other.inserts !== core.inserts, true, 'CONTROL: a second registry');
  other.wire([multiWindow]);
  const counts = { one: 0, two: 0 };
  core.define('x-mw-one', () => { core.effect(() => () => counts.one++); });
  other.define('x-mw-two', () => { other.effect(() => () => counts.two++); });
  const f = await frame();
  f.contentDocument.body.append(document.createElement('x-mw-one'), document.createElement('x-mw-two'));
  core.flush(); other.flush();
  await wait(0);
  /** WHO retires what: each copy's own teardown, spied — a cleanup count alone cannot tell (a second retire of a retired
   *  component does nothing visible), which is how a shared-field check slipped past the first version of this row. */
  const retiredBy = { one: [], two: [] };
  const originals = [[core.inserts, core.inserts.$td], [other.inserts, other.inserts.$td]];
  for (const [copy, reg] of [['one', core.inserts], ['two', other.inserts]]) {
    const own = reg.$td;
    reg.$td = (el) => { retiredBy[copy].push(el.localName); return own(el); };
  }
  try { await die(f.contentWindow); } finally { for (const [reg, own] of originals) reg.$td = own; }
  assert.deepEqual([counts, retiredBy], [{ one: 1, two: 1 }, { one: ['x-mw-one'], two: ['x-mw-two'] }], 'each copy retired exactly its own');
  f.remove();
});
