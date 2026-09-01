/**
 * **Every setter, handed something that is not a function.**
 *
 * Found by asking what a consumer sees when they upgrade across a rename: `render` moved out of
 * `@verajs/renderer` in 0.2.0, so an app that still imports it gets `undefined`, and `undefined` is
 * exactly what every one of these five setters accepted without complaint. Two of them then failed
 * **silently and totally**:
 *
 * - `setRenderScheduler` — every render and every effect is handed to the scheduler, so nothing is
 *   ever drawn and nothing ever runs. Nothing throws, because nothing calls it.
 * - `setRouterRenderer` — every route resolves, every guard runs, the URL changes, and the outlet
 *   stays empty.
 *
 * The other three threw at first use with a message naming an internal — *"html is not a function"*,
 * *"routerSettings.match is not a function"* — which is a true sentence about the wrong thing, and
 * arbitrarily far from the call that caused it.
 *
 * The generalisation worth keeping: **a setter is a deferred call**, so its argument is validated
 * arbitrarily late or never, and the stack at that point no longer contains the mistake. Every other
 * entry point in this framework already guards its input — `wire` refuses a non-finite priority,
 * `createHook` refuses a bad element, `autoloader` refuses a bad `rootDir`. These five were the gap.
 *
 * `__DEV__`-only, so this whole file is a development-condition test: production carries neither the
 * checks nor the text, and an app that does this in production was already broken.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Element', 'Event', 'CustomEvent', 'history', 'location'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};

const core = await load('core');
const router = await load('router');
const { wire } = await load('inserts');

/** Setter -> the name its message must carry, so the reader is told where to look. */
const SETTERS = [
  ['setRenderScheduler', core.setRenderScheduler, /microtask|requestAnimationFrame/],
  ['setHtml', core.setHtml, /tagged template/],
  ['setCss', core.setCss, /tagged template/],
  ['setRouterRenderer', router.setRouterRenderer, /renderInto/],
  ['setMatchFunction', router.setMatchFunction, /matcher/],
];

/** Everything that is not callable, including the two an import failure actually produces. */
const NOT_FUNCTIONS = [undefined, null, 0, '', 'render', {}, []];

test('every setter refuses a non-function and names itself', { skip: isProduction }, () => {
  for (const [name, setter, hint] of SETTERS)
    for (const value of NOT_FUNCTIONS)
      assert.throws(
        () => setter(value),
        (error) =>
          error.message.startsWith(`${name}: expected a function`) &&
          error.message.includes(String(value)) &&
          hint.test(error.message),
        `${name}(${JSON.stringify(value) ?? String(value)}) must throw, naming itself and the fix`
      );
});

test('a setter still takes a function', { skip: isProduction }, () => {
  /** Restores itself, so this suite leaves the scheduler as it found it. */
  const previous = core.setRenderScheduler((run) => run());
  assert.equal(typeof previous, 'function', 'the previous scheduler comes back');
  core.setRenderScheduler(previous);
  assert.doesNotThrow(() => router.setMatchFunction(() => () => false));
});

test('wire names the key that is wrong, not the whole contract', { skip: isProduction }, () => {
  /**
   * The descriptor an upgraded app produces: `on` and `priority` exactly right, `fn` undefined
   * because the import moved. Reporting the full contract sent the reader to check the two that
   * were already correct.
   */
  assert.throws(
    () => wire({ on: 'render', fn: undefined, priority: 50 }),
    (error) =>
      /`fn` is the callback/.test(error.message) &&
      /import that resolved to nothing/.test(error.message) &&
      /renderInto/.test(error.message),
    'a missing `fn` is reported as a missing `fn`'
  );
  assert.throws(
    () => wire({ on: undefined, fn: () => {}, priority: 50 }),
    /`on` names the insert point/,
    'and a missing `on` as a missing `on`'
  );
});
