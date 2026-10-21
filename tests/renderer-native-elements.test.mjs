/**
 * **`@verajs/renderer/native-elements`** (step 2 (b), 2026-10-21): `init` on a BUILT-IN host (a div, a section…) with a
 * custom element's lifecycle, heard by a sentinel custom element inside a closed shadow root (BROWSER-LEDGER). These rows
 * pin the lifecycle — removed: torn down; re-attached: set up again, ONE render; moved: kept; given `init` off the page:
 * set up at its first connect — and the release (with strong links, a removed built-in host was retained, 30 of 30).
 *
 * RETENTION is measured in a child process run with `--expose-gc` — the one exception to "tests do not force collection"
 * (CLAUDE.md): gc is the instrument, alone in its own process, with a retained and a dropped control beside every count.
 * jsdom observes nothing here (no MutationObserver), so its retention answer is the browser's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { init, html, wire, createStore, flush } = await load('core');
const { renderer } = await load('renderer');
const { nativeElements } = await load('renderer/native-elements');
wire([renderer, nativeElements]);
const settle = async () => { flush(); await new Promise((resolve) => setTimeout(resolve, 0)); flush(); };

test('a built-in host removed and re-added is set up again — ONE render, live', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => { setups++; return () => html`<b>${state.n}</b>`; });
  await settle();
  assert.equal(setups, 1, 'CONTROL: set up once');
  host.remove();
  await settle();
  document.body.append(host);
  await settle();
  state.n = 7;
  await settle();
  assert.deepEqual({ setups, bs: host.querySelectorAll('b').length, text: host.textContent }, { setups: 2, bs: 1, text: '7' });
  host.remove();
});

test('a built-in host MOVED in one operation is kept: one setup, still live', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  const a = document.createElement('section');
  const b = document.createElement('section');
  document.body.append(a, b);
  const host = document.createElement('div');
  a.append(host);
  init(host, () => { setups++; return () => html`<b>${state.n}</b>`; });
  await settle();
  b.append(host);
  await settle();
  state.n = 9;
  await settle();
  assert.deepEqual({ setups, text: host.textContent }, { setups: 1, text: '9' });
  a.remove();
  b.remove();
});

test('a built-in host given init OFF the page is set up at its first connect — nothing before, exactly once after', async () => {
  const state = createStore({ n: 0 });
  let setups = 0;
  const host = document.createElement('div');
  init(host, () => { setups++; return () => html`<b>${state.n}</b>`; });
  await settle();
  assert.deepEqual({ setups, html: host.innerHTML }, { setups: 0, html: '' }, 'deferred: no setup, nothing rendered');
  document.body.append(host);
  await settle();
  state.n = 21;
  await settle();
  assert.deepEqual({ setups, text: host.textContent }, { setups: 1, text: '21' });
  host.remove();
});

test('a host its light content shows through: children unchanged, no visible shadow root', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  init(host, () => () => html`<p>one</p><p>two</p>`);
  await settle();
  assert.equal(host.shadowRoot, null, 'the sentinel root is closed: invisible to code');
  assert.equal([...host.children].map((c) => c.textContent).join(), 'one,two', 'the light content is exactly the template');
  host.remove();
});

test('an unsupported tag still renders and warns once, in development', { skip: isProduction && 'the warning is development-only' }, async () => {
  const warn = console.warn;
  const said = [];
  console.warn = (message) => said.push(String(message));
  try {
    for (let i = 0; i < 2; i++) {
      const host = document.createElement('ul');
      document.body.append(host);
      init(host, () => () => html`<li>x</li>`);
      await settle();
      assert.ok(host.querySelector('li'), 'it renders');
      host.remove();
    }
  } finally {
    console.warn = warn;
  }
  assert.equal(said.filter((m) => m.includes('cannot carry')).length, 1, `warned once (${said.join(' | ')})`);
});

/** The child: one mode per process; gc as the instrument; the built-in hosts' elements counted through WeakRefs. */
const child = (mode, fw = true) => JSON.parse(execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
  ${mode === 'with-ssr' ? "await import('@verajs/ssr');" : ''}
  import { JSDOM } from 'jsdom';
  const dom = new JSDOM('<!doctype html><body></body>');
  const w = dom.window;
  ${mode === 'with-ssr' ? '' : "for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[k] = w[k] ?? globalThis[k];"}
  const { load } = await import('./tests/dist.mjs');
  const { init, html, wire, createStore, flush } = await load('core');
  const { renderer } = await load('renderer');
  const { nativeElements } = await load('renderer/native-elements');
  wire([renderer, nativeElements]);
  const settle = () => new Promise((r) => setImmediate(r));
  const gc = async () => { for (let i = 0; i < 6; i++) { global.gc(); await settle(); } };
  const mode = ${JSON.stringify(mode)};
  /** fw false: the no-framework control — the same harness, plain DOM, no init (what survives there is the harness's). */
  const FW = ${fw};
  const S = createStore({ n: 0 });
  const refs = [];
  let setups = 0;
  const keptRef = new WeakRef((globalThis.kept = { kept: true }));
  const droppedRef = (() => new WeakRef({ dropped: true }))();
  const make = () => { const el = w.document.createElement('div'); refs.push(new WeakRef(el)); return el; };
  const body = w.document.body;
  for (let i = 0; i < 30; i++) {
    const host = make();
    if (mode === 'never-connected') { if (FW) init(host, () => { setups++; return () => html\`<b>\${S.n}</b>\`; }); continue; }
    body.append(host);
    if (FW) init(host, () => { setups++; return () => html\`<b>\${S.n}</b>\`; });
  }
  flush(); await settle();
  const hosts = () => [...body.children];
  if (mode === 'removed' || mode === 'with-ssr') for (const h of hosts()) h.remove();
  if (mode === 'two-cycles') {
    const all = hosts();
    for (const h of all) h.remove();
    flush(); await settle();
    for (const h of all) body.append(h);
    flush(); await settle();
    for (const h of all) h.remove();
    /** The harness's own hold, dropped (the no-framework control kept all 30 through it otherwise). */
    all.length = 0;
  }
  flush(); await settle();
  await gc();
  S.n = 1; flush(); await settle();
  process.stdout.write(JSON.stringify({ setups, alive: refs.filter((r) => r.deref() !== undefined).length, kept: keptRef.deref() !== undefined, droppedDied: droppedRef.deref() === undefined }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }));

/**
 * Against the NO-FRAMEWORK control, never against 0: the harness's own last loop binding keeps one element alive with or
 * without vera (CLAUDE.md, measured here too) — the same count with plain DOM is the release.
 */
const released = (mode, setups) => {
  const r = child(mode);
  const plain = child(mode, false);
  assert.ok(r.kept && r.droppedDied && plain.kept && plain.droppedDied, `CONTROLS: the kept object lived and the dropped one died (${JSON.stringify({ r, plain })})`);
  assert.equal(r.setups, setups, `CONTROL: the hosts were set up ${setups} times (${JSON.stringify(r)})`);
  assert.ok(plain.alive <= 1, `CONTROL: the no-framework harness keeps at most its last binding (${plain.alive})`);
  assert.equal(r.alive, plain.alive, `${r.alive} of 30 built-in hosts alive, ${plain.alive} with no framework`);
};

test('30 built-in hosts removed are released', () => released('removed', 30));
test('30 built-in hosts given init and never attached link nothing and are released (their setup never ran)', () => released('never-connected', 0));
test('30 built-in hosts through two full cycles — removed, re-added, removed — are released, set up twice each', () => released('two-cycles', 60));
test('in a process that ALSO imports the server renderer, a client built-in host keeps its lifecycle and is released', () => released('with-ssr', 30));
