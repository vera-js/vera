/**
 * **Development names a store array's `.map` of TEMPLATES in a render when no list module is wired** (2026-10-22,
 * `lists-unwired`): rows are then matched by position. Once per page, and only when the first result is a template — the
 * decision automatic lists make — so it fires exactly when wiring `lists` would change the behavior. This page never
 * wires `lists`; the rows run IN ORDER (the warning is once per page): the silent cases first, then the one that warns,
 * then more that must not warn again. The wired control (zero) is in renderer-automap, which wires it. Production carries
 * neither the check nor the words, and renders the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
wire([renderer]);
const settle = async () => { flush(); await new Promise((r) => setTimeout(r, 0)); flush(); };
const warnings = [];
const warn = console.warn;
console.warn = (...args) => { const line = args.join(' '); if (line.includes('lists-unwired')) warnings.push(line); else warn(...args); };
test.after(() => { console.warn = warn; });
let seq = 0;
const show = async (render) => {
  const tag = `x-lu-${++seq}`;
  define(tag, () => render);
  const el = document.createElement(tag);
  document.body.append(el);
  await settle();
  return el;
};

test('silent: a store array mapped to STRINGS (a .join), an EMPTY store array, a PLAIN array, and a plain COPY of a store array (position on purpose)', async () => {
  const s = createStore({ tags: [{ name: 'a' }, { name: 'b' }], none: [], rows: [{ id: 7 }] });
  const plain = [1, 2];
  const el = await show(() => html`<p>${s.tags.map((t) => t.name).join(', ')}</p>${s.none.map((x) => html`<i>${x}</i>`)}${plain.map((n) => html`<b>${n}</b>`)}${[...s.rows].map((r) => html`<u>${r.id}</u>`)}`);
  assert.equal(el.querySelector('p').textContent, 'a, b', 'CONTROL: it rendered');
  assert.equal(el.querySelectorAll('b').length, 2, 'CONTROL: the plain array rendered');
  assert.equal(el.querySelector('u').textContent, '7', 'CONTROL: the copy rendered');
  assert.equal(warnings.length, 0);
  el.remove();
});

test('inside a server turn it stays silent — automatic lists have no server half yet', { skip: isProduction && 'development only' }, async () => {
  const { inserts } = await load('core');
  inserts.$ss(1);
  try {
    const s = createStore({ rows: [{ id: 1 }] });
    const el = await show(() => html`<ul>${s.rows.map((r) => html`<li>${r.id}</li>`)}</ul>`);
    assert.equal(el.querySelectorAll('li').length, 1, 'CONTROL: it rendered');
    el.remove();
  } finally {
    inserts.$ss(-1);
  }
  /** Runs BEFORE the row that warns (the warning is once per page), so a silence here is the server rule, not the flag. */
  assert.equal(warnings.length, 0);
});


test('a store array mapped to TEMPLATES in a render warns once — across two maps and three renders', { skip: isProduction && 'development only' }, async () => {
  const s = createStore({ rows: [{ id: 1 }, { id: 2 }], other: [{ id: 3 }], tick: 0 });
  const el = await show(() => html`<ul>${s.rows.map((r) => html`<li>${r.id}</li>`)}</ul><ol>${s.other.map((r) => html`<li>${r.id}</li>`)}</ol><i>${s.tick}</i>`);
  s.tick++;
  await settle();
  s.tick++;
  await settle();
  assert.equal(el.querySelectorAll('li').length, 3, 'CONTROL: the rows rendered');
  assert.equal(warnings.length, 1, 'once per page');
  assert.match(warnings[0], /^\[vera\]/);
  assert.match(warnings[0], /wire\(\[renderer, lists\]\)/, 'it names the fix');
  el.remove();
});

/**
 * **A KEYED list stays silent** (2026-11-15): `keyed()` rows are matched by key already, which is all the warning asks
 * for, and the JSX `key={id}` idiom compiles to exactly that. Before this, a keyed store-array `.map` warned and advised
 * the `keyed()` it already used. Each case in a FRESH process (`fixtures/lists-unwired-case.mjs`): the warning is once
 * per page, so in this page a case that warned first would hide the next. The unkeyed case is the control: 1 in
 * development. Production carries no check: 0 for all three.
 */
const caseFile = fileURLToPath(new URL('./fixtures/lists-unwired-case.mjs', import.meta.url));
const condition = process.execArgv.join(' ').match(/--conditions[= ](\S+)/);
const child = (name) => {
  const r = spawnSync(process.execPath, [...(condition ? ['--conditions', condition[1]] : []), caseFile], {
    env: { ...process.env, LU_CASE: name }, cwd: new URL('..', import.meta.url), timeout: 60000, killSignal: 'SIGKILL', encoding: 'utf8',
  });
  assert.equal(r.status, 0, `${name}: ${r.stderr.slice(-1500)}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
};

test('fresh processes: a KEYED store-array .map and the JSX key={id} form say nothing; the unkeyed control warns once', () => {
  const plain = child('unkeyed'), byKey = child('keyed'), jsx = child('jsx');
  assert.deepEqual([plain.rows, byKey.rows, jsx.rows], [3, 3, 3], 'CONTROL: every case rendered its rows, the pushed one too');
  assert.equal(jsx.compiledKeyed, true, 'CONTROL: `key={r.id}` compiled to keyed()');
  assert.deepEqual([plain.other, byKey.other, jsx.other], [[], [], []], 'no other warning');
  assert.deepEqual([plain.warned, byKey.warned, jsx.warned], isProduction ? [0, 0, 0] : [1, 0, 0],
    isProduction ? 'production says nothing' : 'the unkeyed control warns once; a keyed list, by hand or by JSX, never');
});

test('production: the same page renders, and says nothing', { skip: !isProduction && 'production only' }, async () => {
  const s = createStore({ rows: [{ id: 1 }, { id: 2 }] });
  const el = await show(() => html`<ul>${s.rows.map((r) => html`<li>${r.id}</li>`)}</ul>`);
  assert.equal(el.querySelectorAll('li').length, 2);
  assert.equal(warnings.length, 0);
  el.remove();
});
