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

/**
 * **A wait for a tag the server never defines ends at the render's budget, named.** The platform's promise never
 * settles for such a tag, so it is the render's `timeout` that ends the wait — in both shapes a component writes it:
 * the promise a frame callback returns, and an `await` inside an async frame callback (which the drain cannot see
 * into). The warning names the tag, and the list of waits is reset per render, so a later render never names an
 * earlier one's.
 */
const WAITS = new URL('./fixtures/ssr/when-defined-ssr.js', import.meta.url);
const warned = async (tag) => {
  const warnings = [];
  const { warn } = console;
  console.warn = (message) => warnings.push(String(message));
  const start = performance.now();
  try {
    const { html } = await (await import('@verajs/ssr')).renderToStringAsync(WAITS, { tag, timeout: 80 });
    return { html, ms: performance.now() - start, warnings };
  } finally {
    console.warn = warn;
  }
};

test('a whenDefined wait for a tag the server never defines ends at the budget, and the warning names it', async () => {
  for (const tag of ['wait-returned', 'wait-async']) {
    const { ms, warnings } = await warned(tag);
    assert.ok(ms >= 70 && ms < 1000, `${tag}: ${ms} ms`);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /whenDefined for <wd-never-defined>/, tag);
  }
  /** Reset per render: a render that waits on no definition does not name the last render's wait. */
  const plain = await warned('wait-plain');
  assert.equal(plain.warnings.length, 1);
  assert.doesNotMatch(plain.warnings[0], /whenDefined/);
});

/**
 * **The warning names the component still waiting, not only the page**, and prints the fix for a `whenDefined` wait.
 * A nested waiter used to be reported as its page, which on a large page says nothing about where to look.
 */
test('the warning names the nested component whose wait was cut, and the guard that ends it', async () => {
  const { warnings } = await warned('wait-outer');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^\[vera\] ssr: <wait-outer> was served after its 80 ms `timeout` with a promise still pending in <wait-async> \(/);
  assert.match(warnings[0], /`if \(globalThis\.__veraSsrShimmed\) return;`/);
  /** A timeout with no whenDefined wait names the component but prints no whenDefined fix. */
  const plain = await warned('wait-plain');
  assert.match(plain.warnings[0], /still pending in <wait-plain> \(/);
  assert.doesNotMatch(plain.warnings[0], /__veraSsrShimmed/);
});

/**
 * **The guard the warning prints serves exactly what the timeout served, at once and without a warning** — the
 * component's state from before the wait, which is what a browser shows first, so hydration changes nothing.
 */
test('returning before the wait on the server serves the timeout path\'s markup with no wait and no warning', async () => {
  const unguarded = await warned('wait-unguarded');
  const guarded = await warned('wait-guarded');
  /** The control: the unguarded component really did wait out the budget. */
  assert.ok(unguarded.ms >= 70, `unguarded: ${unguarded.ms} ms`);
  assert.equal(unguarded.warnings.length, 1);
  assert.match(unguarded.html, /<p>loading<\/p>/);
  assert.deepEqual(guarded.warnings, []);
  assert.ok(guarded.ms < 50, `guarded: ${guarded.ms} ms`);
  assert.equal(guarded.html.replaceAll('wait-guarded', 'TAG'), unguarded.html.replaceAll('wait-unguarded', 'TAG'));
});
