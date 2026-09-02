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
import { renderToString, renderToStringAsync } from '@verajs/ssr';
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

/**
 * **`setStaticStores` is a global, and an async render holds it across an `await`.**
 *
 * Measured directly: for the whole duration of an async static render, every store the process
 * creates is inert — a write throws in development and does nothing in production. So a second render
 * running inside that window would produce markup with none of its updates applied, silently, which on
 * a server is one request corrupting another's output.
 *
 * `takeTurn` is what prevents it: every render is chained onto one promise, and the chain is rebuilt
 * from both outcomes so a rejection cannot stop later work.
 *
 * ## Getting the overlap on purpose
 *
 * The first version of this raced the two renders by starting them together, and it proved nothing:
 * removing `takeTurn` entirely left it passing, because the synchronous render happened to finish
 * before the async one set the flag. The dynamic render has to be started **after** the static one is
 * already suspended, which is what the tick below is for — and with that, removing the serialisation
 * does fail it.
 */
test('a render started during an async static render is not made inert by it', async () => {
  const writer = new URL('./fixtures/ssr/static-writer-ssr.js', import.meta.url);
  const slow = new URL('./fixtures/ssr/slow-lifecycle-ssr.js', import.meta.url);

  const reference = await renderToString(writer, { tag: 'static-writer-ssr' });
  assert.match(reference.html, /<p>2<\/p>/, 'reactive on its own — the control');

  const suspended = renderToStringAsync(slow, { static: true });
  /** Long enough that the static render has set the flag and is waiting on its timer. */
  await new Promise((resolve) => setTimeout(resolve, 8));

  const during = renderToString(writer, { tag: 'static-writer-ssr' });
  const [, alongside] = await Promise.all([suspended, during]);

  assert.equal(alongside.html, reference.html, 'it waited its turn rather than rendering inert');
});

test('and a static render that throws still frees the queue for the next one', async () => {
  const writer = new URL('./fixtures/ssr/static-writer-ssr.js', import.meta.url);

  const reference = await renderToString(writer, { tag: 'static-writer-ssr' });
  const failing = renderToString(writer, { tag: 'static-writer-ssr', static: true }).then(
    () => 'resolved',
    (error) => `rejected: ${error.constructor.name}`
  );
  const after = renderToString(writer, { tag: 'static-writer-ssr' });
  const [outcome, later] = await Promise.all([failing, after]);

  assert.equal(outcome, 'rejected: TypeError', 'the static render still refused the write');
  assert.equal(later.html, reference.html, 'and the queue carried on, reactive');
});
