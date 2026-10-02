/**
 * **`customElements.whenDefined` on the server is the platform's promise.** It resolved at once, with `undefined`,
 * for any name: code awaiting a definition ran before the class existed and got no class, a client-only component's
 * wait (which never settles in a browser) settled, and a name `define` refuses resolved. jsdom implements the
 * standard's promise and is the reference, run side by side.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const answers = async (win) => {
  const registry = win.customElements;
  class Early extends win.HTMLElement {}
  registry.define('wd-early', Early);
  const late = registry.whenDefined('wd-late');
  /** Compared BEFORE the definition: after it, a fresh resolved promise is the platform's answer too. */
  const same = late === registry.whenDefined('wd-late');
  let settled = false;
  late.then(() => (settled = true));
  await null;
  await null;
  const pending = !settled;
  class Late extends win.HTMLElement {}
  registry.define('wd-late', Late);
  return {
    'resolves with the constructor of a defined name': (await registry.whenDefined('wd-early')) === Early,
    'one promise per name until it is defined': same,
    'pending until define': pending,
    'resolves with the constructor at define': (await late) === Late,
    'refuses a name define refuses': await registry.whenDefined('nodash').then(() => 'resolved', (error) => error.name),
  };
};

test('whenDefined resolves with the constructor, waits for define, and refuses invalid names, as the platform does', async () => {
  const reference = await answers(new JSDOM('<!doctype html><body></body>').window);
  /** The reference must say something, or matching it proves nothing. */
  assert.equal(reference['pending until define'], true);
  assert.equal(reference['one promise per name until it is defined'], true);
  assert.equal(reference['refuses a name define refuses'], 'SyntaxError');
  await import('@verajs/ssr');
  assert.deepEqual(await answers(globalThis), reference);
});
