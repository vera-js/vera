/**
 * **Async effects just work** (Brian, 2026-10-09: async should be predictable without reading docs). An `async`
 * callback returns a promise, and core took any return value as the cleanup: on the next run and on removal it CALLED
 * the promise, printing `[vera] a hook threw:` twice (measured). Only a function is a cleanup now; an async callback
 * runs, and development names it once — it cannot clean up, and what it awaits can arrive late.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);
const doc = dom.window.document;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let seq = 0;

/** Every console line while `run` runs, so a row asserts silence or the one warning it expects. */
const listen = async (run) => {
  const said = [];
  const saved = { warn: console.warn, error: console.error };
  console.warn = (...a) => said.push(`warn ${a.join(' ')}`);
  console.error = (...a) => said.push(`error ${a.join(' ')}`);
  try { await run(); } finally { Object.assign(console, saved); }
  return said;
};

for (const [hook, register] of [
  ['useEffect', (fn) => core.useEffect(fn)],
  ['useLayoutEffect', (fn) => core.useLayoutEffect(fn)],
  ['useHook', (fn) => core.useHook(fn, 65)],
]) test(`an async ${hook} runs on every change and throws nothing on its next run or on removal`, async () => {
  const state = core.createStore({ n: 0 });
  const runs = [];
  const name = `x-async-${seq++}`;
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      register(async () => { const n = state.n; await null; runs.push(n); });
      core.mount();
    }
  });
  const said = await listen(async () => {
    const el = doc.createElement(name);
    doc.body.append(el);
    await tick();
    state.n = 1;
    await tick();
    el.remove();
    await tick();
  });
  assert.deepEqual(runs, [0, 1], 'CONTROL: it ran on the first pass and on the change, its awaits completing');
  assert.equal(said.filter((line) => line.includes('hook-threw')).length, 0, `nothing called the promise as a cleanup: ${said.join(' | ')}`);
  if (isProduction) assert.deepEqual(said, [], 'production is silent');
  else {
    assert.equal(said.length, 1, `development names it ONCE, not per run: ${said.join(' | ')}`);
    assert.match(said[0], new RegExp(`^warn \\[vera\\] core: ${hook} on <${name}> — returned a promise[\\s\\S]*\\(async-callback\\)$`), 'naming the hook, the component and the code');
  }
});

test('a cleanup returned SYNCHRONOUSLY still runs — before the next run, and on removal', async () => {
  const state = core.createStore({ n: 0 });
  const log = [];
  customElements.define('x-async-sync', class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useEffect(() => { const n = state.n; log.push(`run ${n}`); return () => log.push(`clean ${n}`); });
      core.mount();
    }
  });
  const el = doc.createElement('x-async-sync');
  doc.body.append(el);
  await tick();
  state.n = 1;
  await tick();
  el.remove();
  assert.deepEqual(log, ['run 0', 'clean 0', 'run 1', 'clean 1']);
});

test('a cleanup that throws, with no error chain wired, is printed as a CLEANUP — not as a hook', async () => {
  const name = `x-async-${seq++}`;
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      core.init(this);
      core.useEffect(() => () => { throw new Error('cleanup boom'); });
      core.mount();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await tick();
  const said = await listen(async () => { el.remove(); await tick(); });
  const ours = said.filter((line) => line.includes('cleanup boom'));
  assert.equal(ours.length, 1, `printed once: ${said.join(' | ')}`);
  assert.match(ours[0], isProduction ? /^error \[vera\] cleanup-threw / : /^error \[vera\] core: a cleanup — threw \(the function a hook returned[\s\S]*\(cleanup-threw\) /, 'attributed to the cleanup, by code, in every build');
});
