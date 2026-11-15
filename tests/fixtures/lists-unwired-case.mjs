/**
 * The child of `core-lists-unwired`'s fresh-process rows (2026-11-15): ONE case per process, because `lists-unwired` is
 * said once per page, so a case that warned first would hide whether a later one warns. Core and the renderer are wired,
 * `lists` is not; a store array of two rows is mapped in a render, then a third row is pushed (a second render).
 * `LU_CASE`: `unkeyed` (plain templates: the control, it warns), `keyed` (`keyed(r.id, html…)`), `jsx` (the same through
 * `transformJsx`'s `key={r.id}`). Prints one JSON line: the warning count, the other warnings, the rows rendered, and
 * for `jsx` whether the compiled source calls `keyed(`.
 */
import { JSDOM } from 'jsdom';

const name = process.env.LU_CASE;
const said = [];
console.warn = (...args) => said.push(args.map(String).join(' '));
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { load } = await import('../dist.mjs');
const { define, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { keyed } = await load('renderer/keyed');
wire([renderer]);
const settle = async () => { flush(); await new Promise((r) => setTimeout(r, 0)); flush(); };

let view = null;
let compiledKeyed = null;
if (name === 'jsx') {
  const { transformJsx } = await load('jsx');
  const source = transformJsx('export const view = (rows) => rows.map((r) => <li key={r.id}>{r.id}</li>);', 'rows.jsx', { inject: false });
  compiledKeyed = /\bkeyed\(/.test(source);
  globalThis.__luJsx = { html, keyed };
  ({ view } = await import(`data:text/javascript,${encodeURIComponent(`const { html, keyed } = globalThis.__luJsx;\n${source}`)}`));
}

const s = createStore({ rows: [{ id: 1 }, { id: 2 }] });
const rows = () =>
  name === 'unkeyed' ? s.rows.map((r) => html`<li>${r.id}</li>`)
    : name === 'keyed' ? s.rows.map((r) => keyed(r.id, html`<li>${r.id}</li>`))
      : name === 'jsx' ? view(s.rows)
        : (() => { throw new Error(`unknown LU_CASE ${name}`); })();
define('x-lu-case', () => () => html`<ul>${rows()}</ul>`);
document.body.append(document.createElement('x-lu-case'));
await settle();
s.rows.push({ id: 3 });
await settle();
console.log(JSON.stringify({
  warned: said.filter((line) => line.includes('lists-unwired')).length,
  other: said.filter((line) => !line.includes('lists-unwired')),
  rows: document.querySelectorAll('li').length,
  compiledKeyed,
}));
