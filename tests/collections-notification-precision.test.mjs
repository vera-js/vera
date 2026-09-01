/**
 * Which readers a reactive collection wakes, and which it leaves alone.
 *
 * `collections-differential-fuzz` already carries a notification oracle, and it is the right one for
 * what it asks: a reader that must wake when the collection changes and stay quiet when it does not.
 * That is **whole-collection**. This asks the finer question — `set` notifies both the specific key
 * *and* the `GLOBAL` sentinel, so what any given reader wakes for depends entirely on what it tracked.
 *
 * The two failures are asymmetric. **Under-notification is stale UI**: a component showing a value the
 * map no longer holds. **Over-notification is invisible** — every component reading one key re-renders
 * on every change to any key, nothing fails, and the page is merely slower than it should be for as
 * long as it exists.
 *
 * ## The case precision could get wrong
 *
 * A reader tracking one key must stay quiet for other keys *and still wake on `clear()`*, which
 * removes its key without ever mentioning it. Quiet-for-others and awake-on-clear pull in opposite
 * directions, and both are asserted.
 *
 * ## One over-notification, measured and left alone
 *
 * A `size` reader wakes when an existing key is set to a **new value**, which cannot change the size.
 * `set` notifies `GLOBAL` on any change and `size` tracks `GLOBAL`; separating structural from value
 * changes would need a second sentinel. Recorded here rather than asserted away, so the choice is
 * visible if the cost ever matters.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body><div id="app"></div></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame',
  'MutationObserver', 'ShadowRoot',
])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer } = await load('renderer');
const { html } = await load('renderer/tag');
const { collections } = await load('reactivity/collections');
core.wire([renderer, collections]);

const app = dom.window.document.getElementById('app');
const frame = () => new Promise((resolve) => setTimeout(resolve, 25));
let nextTag = 0;

/** Mounts a component whose template reads the map in one particular way, and counts its renders. */
const watching = async (read) => {
  const store = core.createStore({ m: new Map([['a', 1], ['b', 2]]) });
  let renders = 0;
  const tag = `precision-${nextTag++}`;
  dom.window.customElements.define(tag, class extends dom.window.HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      core.render(() => { renders++; return html`<p>${String(read(store.m))}</p>`; });
    }
  });
  app.appendChild(dom.window.document.createElement(tag));
  await frame();
  assert.ok(renders > 0, 'the component never rendered — the measurement would be vacuous');

  return async (act) => {
    const before = renders;
    act(store.m);
    await frame();
    return renders > before;
  };
};

test('a reader of one key wakes for that key and ignores the others', async () => {
  const after = await watching((map) => map.get('a'));

  assert.equal(await after((map) => map.set('a', 99)), true, 'its own key changed');
  assert.equal(await after((map) => map.set('b', 99)), false, 'another key changed');
  assert.equal(await after((map) => map.set('c', 3)), false, 'a key was added');
  assert.equal(await after((map) => map.delete('b')), false, 'another key was removed');
});

/** The opposite pull: `clear()` removes its key without ever naming it. */
test('and still wakes when the collection is cleared', async () => {
  const after = await watching((map) => map.get('a'));
  assert.equal(await after((map) => map.clear()), true, 'its key is gone, so it must re-render');
});

test('deleting the key a reader watches wakes it', async () => {
  const after = await watching((map) => map.get('a'));
  assert.equal(await after((map) => map.delete('a')), true);
});

test('a reader of size wakes for structural changes', async () => {
  const after = await watching((map) => map.size);

  assert.equal(await after((map) => map.set('c', 3)), true, 'a key was added');
  assert.equal(await after((map) => map.delete('c')), true, 'a key was removed');
  assert.equal(await after((map) => map.clear()), true, 'everything was removed');
});

test('and one that iterates wakes for a value change, since iteration can expose it', async () => {
  const after = await watching((map) => [...map.entries()].join());
  assert.equal(await after((map) => map.set('a', 99)), true);
});

/** The control that gives every "quiet" above its meaning. */
test('a component that reads nothing from the map is never woken by it', async () => {
  const after = await watching(() => 'constant');

  assert.equal(await after((map) => map.set('a', 99)), false);
  assert.equal(await after((map) => map.set('z', 1)), false);
  assert.equal(await after((map) => map.clear()), false);
});
