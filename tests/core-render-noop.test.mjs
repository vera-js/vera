/**
 * `render()` with no component being set up did nothing, and said nothing.
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

test('a second render() in one setup is reported', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  let host;
  const warnings = await captureWarnings(async () => {
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

  assert.equal(warnings.length, 1, 'exactly one warning, for the second call');
  assert.match(warnings[0], /write to a store/, 'and it must name what to do instead');
  assert.match(host._root.textContent, /first/, 'the first call is the one that drew');
});

/**
 * A handler runs long after setup ended, so the instance is definitively gone. This is the case the
 * message is really for: re-rendering is what the store is for, and calling `render()` again is
 * neither necessary nor sufficient.
 *
 * Deliberately *not* tested: `render()` after an `await` inside `connectedCallback`. That one is a
 * race rather than a rule — if nothing else has mounted in between, the instance is still current
 * and it succeeds. `init()`'s own warning documents the same asymmetry: a later mount moves the
 * pointer, so a check can miss a case but cannot invent one.
 */
test('render() from a handler after setup is reported', { skip: isProduction && 'the guard is __DEV__' }, async () => {
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

  const warnings = await captureWarnings(async () => {
    host.later();
  });
  assert.equal(warnings.length, 1, 'the handler found no instance to render into');
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
