/**
 * `render()` with no component being set up did nothing, and said nothing. **Since 2026-10-09 it THROWS `no-owner`, in
 * every build** (Brian: one rule for every "no owner" case) — the rows below assert the throw, and that its message
 * names what to do instead (write to a store). The silent-path rows still assert silence.
 *
 * It ends the setup started by `init()` — it runs the first pass of every hook registered since,
 * then clears the current instance. So a *second* call has no instance to find, and returned in
 * silence: the component drew whatever the first call declared and the next line of the file was
 * inert. All three ways to arrive there look like working code, which is why silence was the wrong
 * answer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
core.wire([renderer]);

const captureWarnings = async (run) => {
  const warnings = [];
  const native = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  try {
    await run();
  } finally {
    console.warn = native;
  }
  return warnings.filter((message) => message.includes('render() did nothing'));
};

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

/** Collects what a lifecycle callback threw — it reaches the window's `error` event, not the caller. */
const captureThrown = async (run) => {
  const thrown = [];
  const onError = (event) => { thrown.push(String(event.error)); event.preventDefault(); };
  dom.window.addEventListener('error', onError);
  try { await run(); } finally { dom.window.removeEventListener('error', onError); }
  return thrown;
};

test('a second render() in one setup throws no-owner, naming the store', async () => {
  let host;
  const thrown = await captureThrown(async () => {
    class Twice extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        const state = core.createStore({ n: 1 });
        core.render(() => core.html`<p>first ${state.n}</p>`);
        core.render(() => core.html`<p>second ${state.n}</p>`);
      }
    }
    customElements.define('x-render-twice', Twice);
    host = new Twice();
    document.body.append(host);
    await frame();
  });
  assert.equal(thrown.length, 1, `exactly one throw, for the second call: ${thrown.join(' | ')}`);
  assert.match(thrown[0], /no-owner/, 'the no-owner code');
  if (!isProduction) assert.match(thrown[0], /write to a store/, 'and development names what to do instead');
  assert.match(host._root.textContent, /first/, 'the first call is the one that drew');
});

/**
 * A handler runs long after setup ended, so the instance is definitively gone. This is the case the
 * message is really for: re-rendering is what the store is for, and calling `render()` again is
 * neither necessary nor sufficient.
 *
 * `render()` after an `await` inside `connectedCallback` is no longer a race: setup ends at the end of `init()`'s
 * microtask turn, so it throws the same way every time (tests/core-no-owner.test.mjs).
 */
test('render() from a handler after setup throws no-owner', async () => {
  class Handler extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ n: 0 });
      this.later = () => core.render(() => core.html`<p>${state.n}</p>`);
      core.render(() => core.html`<p>${state.n}</p>`);
    }
  }
  customElements.define('x-render-handler', Handler);
  const host = new Handler();
  document.body.append(host);
  await frame();

  assert.throws(() => host.later(), /no-owner/, 'the handler found no instance to render into');
});

/** The ordinary path must stay silent, or the warning is noise. */
test('one render() in setup warns about nothing', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const warnings = await captureWarnings(async () => {
    class Fine extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        const state = core.createStore({ n: 0 });
        core.render(() => core.html`<p>${state.n}</p>`);
      }
    }
    customElements.define('x-render-fine', Fine);
    document.body.append(new Fine());
    await frame();
  });
  assert.deepEqual(warnings, []);
});

/** And a bare `render()`, which commits setup for a component that draws nothing. */
test('a bare render() in setup warns about nothing', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const warnings = await captureWarnings(async () => {
    class SideEffect extends HTMLElement {
      connectedCallback() {
        core.init(this, { mode: 'open' });
        core.useEffect(() => {});
        core.render();
      }
    }
    customElements.define('x-render-bare', SideEffect);
    document.body.append(new SideEffect());
    await frame();
  });
  assert.deepEqual(warnings, []);
});
