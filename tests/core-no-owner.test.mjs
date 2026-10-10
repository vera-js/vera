/**
 * **A hook, `render()` or `mount()` with no component being set up THROWS, in every build** (Brian, 2026-10-09: one
 * rule for every "no owner" case). Setup runs synchronously from `init(this)` and ends at the end of that microtask
 * turn, so a hook after the first `await` in setup fails the SAME way whether or not another component connected in
 * between — before, it attached to whichever component was set up last, or was dropped silently (the old async-setup
 * row). The pair of rows "with" and "without" another component is what proves the microtask, not luck, decides.
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
let seq = 0;
const NO_OWNER = isProduction ? /\[vera\] core: .+ — https:\/\/verajs\.dev\/e\/no-owner$/ : /no component being set up[\s\S]*before the first `await`[\s\S]*useEffect\(fn, this\)/;

/** A component whose setup awaits, then creates a hook; `ready` settles with what that did. */
const awaiting = () => {
  const name = `x-no-owner-${seq++}`;
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      this.ready = (async () => {
        core.init(this);
        await null;
        core.useEffect(() => {});
      })();
    }
  });
  return name;
};

test('a hook after an `await` in setup throws — no other component connected in between', async () => {
  const el = doc.createElement(awaiting());
  doc.body.append(el);
  await assert.rejects(el.ready, NO_OWNER);
  el.remove();
});

test('…and throws the SAME way when another component connected in between', async () => {
  const el = doc.createElement(awaiting());
  doc.body.append(el);
  /** Another component sets up synchronously in the same turn — before, the awaiting one's hook joined IT. */
  const other = `x-no-owner-${seq++}`;
  let otherHooks = 0;
  customElements.define(other, class extends HTMLElement { connectedCallback() { core.init(this); otherHooks = this._$h$?.flat?.().length ?? 0; } });
  const b = doc.createElement(other);
  doc.body.append(b);
  await assert.rejects(el.ready, NO_OWNER);
  assert.equal(b._$h$.reduce((n, set) => n + set.size, 0), otherHooks, 'and the other component gained no stray hook');
  el.remove();
  b.remove();
});

test('render() and mount() after setup throw the same code — from a handler, later', async () => {
  const name = `x-no-owner-${seq++}`;
  customElements.define(name, class extends HTMLElement { connectedCallback() { core.init(this); core.render(() => core.html`<p>x</p>`); } });
  const el = doc.createElement(name);
  doc.body.append(el);
  await null;
  assert.throws(() => core.render(() => core.html`<p>again</p>`), NO_OWNER, 'render()');
  assert.throws(() => core.mount(), NO_OWNER, 'mount()');
  assert.throws(() => core.useEffect(() => {}), NO_OWNER, 'a hook');
  el.remove();
});

test('with the element given explicitly, a hook works anywhere — after an `await`, in a handler', async () => {
  const state = core.createStore({ n: 0 });
  const runs = [];
  const name = `x-no-owner-${seq++}`;
  customElements.define(name, class extends HTMLElement {
    connectedCallback() {
      this.ready = (async () => {
        core.init(this);
        core.mount();
        await null;
        const run = core.useHook(() => { runs.push(state.n); }, 65, this);
        run(undefined, true);
      })();
    }
  });
  const el = doc.createElement(name);
  doc.body.append(el);
  await el.ready;
  state.n = 1;
  await null;
  assert.deepEqual(runs, [0, 1], 'it ran its first pass and heard the change');
  el.remove();
});

test('an element from ANOTHER window is a component element — init and allowRenderLoop accept it (nodeType, not instanceof)', () => {
  /** A second window: its elements fail this window's `instanceof Element` — what a popped-out window's component is. */
  const other = new JSDOM('<!doctype html><body></body>');
  const el = other.window.document.createElement('div');
  other.window.document.body.append(el);
  assert.equal(el instanceof dom.window.Element, false, 'CONTROL: it is not an instance of this window\'s Element');
  assert.doesNotThrow(() => core.init(el), 'init accepts it');
  assert.doesNotThrow(() => core.allowRenderLoop(el), 'and allowRenderLoop');
  core.mount();
});
