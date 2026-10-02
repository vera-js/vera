/**
 * **A thrown value that is not an Error still produces the named error.** JavaScript can throw `null` or `undefined`,
 * and the messages built from `(error as Error).message` crashed on both, so a props setter or a bound-property setter
 * that threw one surfaced as "Cannot read properties of null", naming nothing the caller did. And `options: null`,
 * possible from JavaScript, threw an unnamed destructuring error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString, renderToStringAsync } from '@verajs/ssr';

const MODULE = new URL('./fixtures/ssr/thrown-values-ssr.js', import.meta.url);

test('a props setter that throws null is reported by name, with the thrown value as the cause', async () => {
  await assert.rejects(renderToString(MODULE, { tag: 'throws-null', props: { item: 1 } }), (error) => {
    assert.match(error.message, /<throws-null> refused a value from `props` — null\./);
    assert.equal(error.cause, null);
    return true;
  });
});

test('a bound property whose setter throws undefined is reported by name', async () => {
  await assert.rejects(renderToString(MODULE, { tag: 'binds-thrower' }), /refused the bound property `\.boom` — undefined\./);
});

test('options that are not an object are refused by name, in both entry points', async () => {
  for (const render of [renderToString, renderToStringAsync])
    for (const options of [null, 'x', 5, []]) await assert.rejects(render(MODULE, options), /`options` must be an object, or left out/, String(options));
});
