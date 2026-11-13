/**
 * **A lists-wired client ADOPTS the server's rows of an automatic `.map`** (B4, 2026-10-22). The server renders the rows
 * plainly whatever is wired; hydration adopts one instance per row from the client's own row results, and the automatic
 * list takes ownership of them (`'value'` handler → `ADOPTED`) instead of claiming, which rebuilt every row. Rows: node
 * identity kept with no warning, then a reverse whose rows follow their items; a component row set up once, its state
 * following its item; server data stale by one field (adopted, the text patched); a client with a row more than the
 * server (built correctly); and an OLD-shape value handler (two parameters) still claiming under this base.
 */
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const served = execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', `
  import { renderToString } from '@verajs/ssr';
  process.stdout.write((await renderToString(new URL('./tests/fixtures/ssr/automatic-list-ssr.js', 'file://' + process.cwd() + '/'), { tag: 'automatic-list-ssr' })).html);
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });

const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'Comment', 'Text', 'DocumentFragment', 'ShadowRoot', 'MutationObserver', 'customElements', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[k] = dom.window[k];
const { wire, html, init, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { lists } = await load('renderer/keyed');
wire([renderer, hydration, lists]);
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); flush(); };
let setups = 0;
/** The same template as the server's row. `.item` arrives from the parent AFTER the row upgrades, so it reads `?.`. */
customElements.define('al-row', class extends HTMLElement {
  connectedCallback() { init(this, () => { setups++; return () => html`<i>${this.item?.label}</i>`; }); }
});
let seq = 0;
/** Serves the markup under a fresh tag (each row needs its own definition) and hydrates it with `rows`. */
const hydrate = async (rows) => {
  const tag = `automatic-list-${++seq}`;
  const root = document.getElementById('root');
  root.innerHTML = served.replaceAll('automatic-list-ssr', tag);
  const host = root.firstElementChild;
  const before = { li: [...host.querySelectorAll('li')], row: [...host.querySelectorAll('al-row')] };
  const s = createStore({ rows });
  const warned = [];
  const warn = console.warn;
  console.warn = (...a) => warned.push(a.map(String).join(' '));
  try {
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() { init(this, () => () => html`<ul>${s.rows.map((r) => html`<li>${r.label}</li>`)}</ul><div>${s.rows.map((r) => html`<al-row .item=${r}></al-row>`)}</div>`); }
    });
    await settle();
  } finally {
    console.warn = warn;
  }
  return { host, s, before, warned };
};
const rows3 = () => [{ id: 1, label: 'a' }, { id: 2, label: 'b' }, { id: 3, label: 'c' }];

test('CONTROL: the server rendered three plain rows and three component rows', () => {
  assert.match(served, /<ul><li>a<\/li><li>b<\/li><li>c<\/li><\/ul>/, served);
  assert.equal((served.match(/<al-row/g) ?? []).length, 3);
});

test('the server rows are ADOPTED (identity kept, no warning), and a reverse moves them with their items', async () => {
  const { host, s, before, warned } = await hydrate(rows3());
  const li = [...host.querySelectorAll('li')];
  assert.ok(li.length === 3 && li.every((n, i) => n === before.li[i]), 'the server <li>s were adopted, not rebuilt');
  assert.deepEqual(warned, [], 'no hydration fallback, no warning');
  /** D28: hydrating with `wire([renderer, hydration, lists])`, the full renderer is connected, so lists-no-renderer is silent. */
  assert.ok(!warned.some((line) => line.includes('lists-no-renderer')), 'no lists-no-renderer under the full renderer');
  const byText = new Map(li.map((n) => [n.textContent, n]));
  s.rows.reverse();
  await settle();
  const after = [...host.querySelectorAll('li')];
  assert.equal(after.map((n) => n.textContent).join(''), 'cba');
  assert.ok(after.every((n) => byText.get(n.textContent) === n), 'each adopted row moved with its item');
});

test('a component row is adopted and set up ONCE; after a reverse each element (its state) moves with its item', async () => {
  const start = setups;
  const { host, s, before, warned } = await hydrate(rows3());
  const rows = [...host.querySelectorAll('al-row')];
  assert.ok(rows.every((n, i) => n === before.row[i]), 'the server component elements were adopted');
  assert.equal(rows.map((n) => n.textContent).join(''), 'abc', 'CONTROL: they rendered');
  assert.deepEqual(warned, []);
  assert.equal(setups - start, 3, 'one setup per row');
  const byLabel = new Map(rows.map((n) => [n.item.label, n]));
  s.rows.reverse();
  await settle();
  const after = [...host.querySelectorAll('al-row')];
  assert.equal(after.map((n) => n.textContent).join(''), 'cba');
  assert.ok(after.every((n) => byLabel.get(n.item.label) === n), 'each element — and the setup state it holds — follows its item');
  assert.equal(setups - start, 3, 'no row set up again');
});

/** Stale server data is a MISMATCH, as for any hydrated text: the standard fallback (warned, rendered fresh, correct). */
test('server data stale by one field takes the standard mismatch path: warned, rendered correctly', async () => {
  const fresh = rows3();
  fresh[1].label = 'B!';
  const { host, warned } = await hydrate(fresh);
  assert.equal([...host.querySelectorAll('li')].map((n) => n.textContent).join(','), 'a,B!,c');
  assert.equal(warned.filter((w) => /hydration-fallback/.test(w)).length, 1, 'the standard hydration fallback (its code, in either build), once');
});

test('a client with a row more than the server renders all of them correctly', async () => {
  const more = [...rows3(), { id: 4, label: 'd' }];
  const { host } = await hydrate(more);
  assert.equal([...host.querySelectorAll('li')].map((n) => n.textContent).join(''), 'abcd');
});

/**
 * **Cross-version, the old handler's side**: a two-parameter `'value'` handler under this base (which passes a third) still
 * CLAIMS as before — the server span goes. (The new handler under an older base, which passes two, is the client-render
 * path every automatic-list row exercises: no third argument, so it builds.) LAST: it stays wired.
 */
test('an OLD-shape value handler (two parameters) still claims under this base: the server span is removed', async () => {
  let asked = 0;
  const old = (part, value) => { if (Array.isArray(value) && value[0]?.strings?.join('').startsWith('<li>')) { asked++; return true; } return false; };
  assert.equal(old.length, 2, 'CONTROL: the old shape');
  wire({ on: 'value', priority: 49, fn: old });
  const { host } = await hydrate(rows3());
  assert.equal(asked, 1, 'asked once, for the <li> list');
  assert.equal(host.querySelectorAll('li').length, 0, 'its claim removed the server rows (it committed nothing)');
});
