/**
 * **`static: true` must change the speed and nothing else.**
 *
 * A server render is one shot: the subscriptions built while it runs are never fired afterwards, so
 * tracking every property read to create them is pure cost. Measured on a component rendering twenty
 * rows, the proxy behind `createStore` is the *entire* reactivity overhead — about 40 µs against a
 * 15 µs baseline — while effects and the scheduler cost nothing detectable. Skipping it is worth
 * roughly 3x.
 *
 * The whole safety of the feature rests on one property: **the markup is identical**. So rather than
 * assert that on a chosen example, this renders *every* fixture in the suite both ways and compares.
 * A second renderer would have been a third path to keep in sync; a mode with this gate cannot drift
 * without failing here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { renderToString } from '@verajs/ssr/vera';
import { isProduction } from './dist.mjs';

/**
 * The refusal's *explanation* folds away in production — carrying the full sentence cost 167 gzipped
 * bytes in core, most of the feature's budget, for text an operator reads once. **The throw itself
 * does not fold**, because a server runs the production build and that is the only place this guard
 * matters. So the tests match on what both builds say and check the wording only where it exists.
 */
const REFUSED = /static render|declared itself static/;

const dir = new URL('./fixtures/ssr/', import.meta.url);
const fixtures = readdirSync(dir).filter((name) => name.endsWith('.js'));

test('every fixture renders identically with and without static', async () => {
  const differed = [];
  const refused = [];
  let compared = 0;

  for (const name of fixtures) {
    const url = new URL(name, dir);
    let normal;
    try {
      normal = await renderToString(url);
    } catch {
      /** A fixture that fails on its own terms has nothing to say about this. */
      continue;
    }

    let quick;
    try {
      quick = await renderToString(url, { static: true });
    } catch (error) {
      /**
       * A fixture that writes to a store during its render is *supposed* to be refused — that is the
       * feature. Anything else failing is a defect.
       */
      if (REFUSED.test(error.message)) refused.push(name);
      else differed.push(`${name}: threw ${error.message.slice(0, 60)}`);
      continue;
    }

    compared++;
    if (quick.html !== normal.html) differed.push(`${name}: markup`);
    else if (quick.styles !== normal.styles) differed.push(`${name}: styles`);
    else if (quick.title !== normal.title) differed.push(`${name}: title`);
  }

  assert.ok(compared > 20, `only ${compared} fixtures were comparable — the walk found nothing`);
  assert.deepEqual(
    differed,
    [],
    `static mode changed the output of ${differed.length} fixture(s), which it must never do:\n  ` +
      `${differed.join('\n  ')}\n(${compared} identical, ${refused.length} refused for writing to a store.)`
  );
});

/**
 * The refusal is the other half. A page declared static that writes to a store would render markup
 * reflecting none of those writes — silently, and only on the server. Saying so is what stops
 * `static: true` becoming a way to ship a subtly wrong page.
 */
test('a store written during a static render is refused, naming the option', async () => {
  const writer = new URL('./fixtures/ssr/static-writer-ssr.js', import.meta.url);

  const reactive = await renderToString(writer, { tag: 'static-writer-ssr' });
  assert.match(reactive.html, /<p>2<\/p>/, 'reactive, the write reaches the markup');

  await assert.rejects(
    () => renderToString(writer, { tag: 'static-writer-ssr', static: true }),
    (error) => {
      assert.equal(error.constructor.name, 'TypeError');
      assert.match(error.message, REFUSED, 'says why it refused, in either build');
      if (!isProduction)
        assert.match(error.message, /static: true/, 'and development names the option that caused it');
      return true;
    }
  );

  /** And the refusal must not leave the next render inert — the flag is restored in a `finally`. */
  const after = await renderToString(writer, { tag: 'static-writer-ssr' });
  assert.equal(after.html, reactive.html, 'a later render is reactive again');
});

test('the option is checked like the others', async () => {
  const url = new URL('./fixtures/ssr/hello-ssr.js', import.meta.url);
  await assert.rejects(
    () => renderToString(url, { tag: 'hello-ssr', static: 'yes' }),
    /`static` must be true or false/
  );
});
