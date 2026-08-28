/**
 * What a server render does when a component throws.
 *
 * `renderToString` carries explicit machinery for this — errors are collected through the `'error'`
 * insert, the walk finishes, and one error is thrown at the end naming every component that failed —
 * and **no test rendered a throwing component**. The comment explains the design ("catch it to fall
 * back to a client-rendered shell, which is what `renderToString` throwing means in React and Vue
 * too. It is never right to ship the empty markup this replaces") and nothing held it to it.
 *
 * The reset is the part that matters most on a server: `renderErrors` is module state, so a failure
 * that survived into the next call would make one bad request poison every request after it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderToString } = await import('@verajs/ssr/vera');
const url = (file) => new URL(`./fixtures/ssr/${file}`, import.meta.url);

test('a component that throws fails the render rather than serving empty markup', async () => {
  await assert.rejects(
    () => renderToString(url('throws-ssr.js'), { tag: 'throws-ssr' }),
    (error) => {
      assert.match(error.message, /<throws-ssr> threw while rendering/, 'the message must name the component');
      assert.match(error.message, /markup would be empty/, 'and say why it refuses to serve it');
      assert.match(error.message, /component exploded/, 'and carry the original message');
      assert.equal(error.cause?.message, 'component exploded', 'the original error must survive as `cause`');
      return true;
    }
  );
});

/**
 * Module state, so this is the one that decides whether a server survives a bad request. A failure
 * that leaked into the next call would take down every render after the first broken component.
 */
test('a failed render does not poison the next one', async () => {
  const good = () => renderToString(url('hello-ssr.js'), { tag: 'hello-ssr' });

  const before = await good();
  assert.ok(before.html.length > 0);

  await assert.rejects(() => renderToString(url('throws-ssr.js'), { tag: 'throws-ssr' }));

  const after = await good();
  assert.equal(after.html, before.html, 'the render after a failure differs from the one before it');

  const again = await good();
  assert.equal(again.html, before.html, 'and the one after that');
});
