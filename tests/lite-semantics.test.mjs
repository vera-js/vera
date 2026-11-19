/**
 * **Lite's own semantics, which core's suites cannot reach** (2026-11-19, the tier suites: core's signal, lifecycle,
 * release and retention suites observe through core-only machinery — its hook primitive, `effect`, `createStore`). The
 * same questions, asked of lite's shipped bundle through real components:
 *
 * - a signal is shallow and compares by `Object.is`; `in`, keys and `for…in` subscribe to nothing; `{ deep: true }` is
 *   core's, named in development and shallow here;
 * - a removed component renders nothing more on a write, and a re-added one renders the current value, once;
 * - a render that throws is that component's alone: a sibling renders and updates, and the component recovers on a good
 *   value;
 * - a removed component is freed — measured in an isolated child process with gc as the instrument and both controls
 *   (CLAUDE.md: a retained control that must stay alive, a dropped plain object that must die).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
const { define, html, signal } = await load('lite');

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;
/** A component rendering `draw()`, counting its renders; mounted. */
const counted = (draw) => {
  const tag = `lite-sem-${seq++}`;
  const state = { renders: 0 };
  define(tag, () => () => {
    state.renders++;
    return draw();
  });
  state.element = document.body.appendChild(document.createElement(tag));
  return state;
};

test('a signal is shallow: replacing .value re-renders its readers, mutating inside it does not', async () => {
  const s = signal({ x: 1 });
  const c = counted(() => html`<p>${s.value.x}</p>`);
  assert.equal(c.renders, 1, 'CONTROL: rendered');
  s.value.x = 2;
  await settle();
  assert.equal(c.renders, 1, 'a mutation inside is not a write');
  s.value = { x: 3 };
  await settle();
  assert.equal(c.renders, 2, 'CONTROL: replacing it is');
  assert.equal(c.element.textContent, '3');
});

test('a write notifies when the new value is not Object.is the held one: -0 over 0 is a change, NaN over NaN is not', async () => {
  const zero = signal(0);
  const nan = signal(NaN);
  const c = counted(() => html`<p>${zero.value}${nan.value}</p>`);
  zero.value = 0;
  nan.value = NaN;
  await settle();
  assert.equal(c.renders, 1, 'the same value by Object.is: nothing');
  zero.value = -0;
  await settle();
  assert.equal(c.renders, 2, '-0 over 0 is a change');
  nan.value = 1;
  await settle();
  assert.equal(c.renders, 3, 'CONTROL: a different value notifies');
});

test('`in`, keys and for…in on a signal subscribe to nothing: only reading .value does', async () => {
  const s = signal('a');
  const c = counted(() => {
    const seen = ['value' in s, Object.keys(s).length];
    for (const key in s) seen.push(key);
    return html`<p>${seen.join()}</p>`;
  });
  s.value = 'b';
  await settle();
  assert.equal(c.renders, 1, 'no trap subscribed the render');
  const reader = counted(() => html`<p>${s.value}</p>`);
  s.value = 'c';
  await settle();
  assert.equal(reader.renders, 2, 'CONTROL: reading .value subscribes');
});

test('{ deep: true } is core\'s: lite names it in development and stays shallow', async () => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.map(String).join(' '));
  let s;
  try {
    s = signal({ x: 1 }, { deep: true });
  } finally {
    console.warn = warn;
  }
  if (!isProduction) assert.ok(said.some((line) => /tier-needs-core/.test(line)), `development names it: ${said.join(' | ')}`);
  const c = counted(() => html`<p>${s.value.x}</p>`);
  s.value.x = 2;
  await settle();
  assert.equal(c.renders, 1, 'shallow, whatever the option says');
});

test('a removed component renders nothing more on a write; re-added, it renders the current value once', async () => {
  const s = signal(1);
  const c = counted(() => html`<p>${s.value}</p>`);
  c.element.remove();
  s.value = 2;
  await settle();
  assert.equal(c.renders, 1, 'removed: the write did not render it');
  document.body.append(c.element);
  await settle();
  assert.equal(c.element.textContent, '2', 're-added: the current value');
  const after = c.renders;
  s.value = 3;
  await settle();
  assert.equal(c.renders, after + 1, 'CONTROL: re-added, a write renders it again, once');
});

test('an event on a removed component\'s element is harmless: its handler does not run, nothing throws', async () => {
  let clicks = 0;
  const errors = [];
  const listener = (event) => errors.push(event.error);
  dom.window.addEventListener('error', listener);
  try {
    const c = counted(() => html`<button @click=${() => clicks++}>b</button>`);
    const button = c.element.querySelector('button');
    button.click();
    assert.equal(clicks, 1, 'CONTROL: the handler runs while connected');
    c.element.remove();
    button.click();
    await settle();
    assert.deepEqual(errors, [], 'nothing threw');
  } finally {
    dom.window.removeEventListener('error', listener);
  }
});

test('a render that throws is that component\'s alone: a sibling renders and updates, and it recovers on a good value', async () => {
  const errors = [];
  const listener = (event) => {
    errors.push(String(event.error?.message ?? event.message));
    event.preventDefault();
  };
  dom.window.addEventListener('error', listener);
  try {
    const bad = signal(true);
    const good = signal('a');
    const broken = counted(() => {
      if (bad.value) throw new Error('planted render failure');
      return html`<p>fixed</p>`;
    });
    const sibling = counted(() => html`<p>${good.value}</p>`);
    assert.ok(errors.some((e) => /planted render failure/.test(e)), `CONTROL: the failure was reported: ${errors.join(' | ')}`);
    good.value = 'b';
    await settle();
    assert.equal(sibling.element.textContent, 'b', 'the sibling renders and updates');
    bad.value = false;
    await settle();
    assert.equal(broken.element.textContent, 'fixed', 'the component recovers on its next good render');
  } finally {
    dom.window.removeEventListener('error', listener);
  }
});

/**
 * **A removed component is freed**: a module-level signal read by 30 components, 25 of them removed. The signal must not
 * keep a removed one reachable (its readers let go at retirement). Measured in a child process, gc the instrument:
 * the RETAINED control (the 5 still connected) must stay alive, the DROPPED control (a plain object) must die. jsdom's
 * MutationObserver holds observed nodes strongly (CLAUDE.md), so this asks of nothing observed.
 */
const child = () =>
  JSON.parse(
    execFileSync(process.execPath, [...(isProduction ? [] : ['--conditions', 'development']), '--expose-gc', '--no-warnings', '--input-type=module', '-e', `
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './tests/dist.mjs';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole: new VirtualConsole() });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Text', 'Comment', 'Event', 'CustomEvent', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame']) globalThis[key] = dom.window[key];
const { define, html, signal } = await load('lite');
const shared = signal(0);
define('lite-gc', () => () => html\`<p>\${shared.value}</p>\`);
const made = (count) => Array.from({ length: count }, () => new WeakRef(document.body.appendChild(document.createElement('lite-gc'))));
const removed = made(25);
const kept = made(5);
for (const ref of removed) ref.deref().remove();
shared.value = 1;
await new Promise((r) => setTimeout(r, 0));
const dropped = new WeakRef({ plain: true });
for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); globalThis.gc(); }
const alive = (refs) => refs.filter((ref) => ref.deref() !== undefined).length;
process.stdout.write(JSON.stringify({ removedAlive: alive(removed), keptAlive: alive(kept), droppedDied: dropped.deref() === undefined, keptText: kept[0].deref()?.textContent }));
`], { cwd: new URL('..', import.meta.url), encoding: 'utf8' }),
  );

test('a removed component is freed: a module-level signal keeps none of them (gc in a child, both controls)', () => {
  const r = child();
  assert.equal(r.droppedDied, true, 'CONTROL: gc ran — a dropped plain object died');
  assert.equal(r.keptAlive, 5, 'CONTROL: the connected components are alive (the run is not collecting what it must keep)');
  assert.equal(r.keptText, '1', 'CONTROL: the kept ones rendered the write');
  assert.equal(r.removedAlive, 0, `every removed component was freed (${r.removedAlive} of 25 alive)`);
});
