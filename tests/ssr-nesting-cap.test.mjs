/**
 * Where the component-nesting cap actually falls.
 *
 * The cap was raised from 32 to 256 three commits before this audit began, and the check is
 * `if (depth > MAX_DEPTH) throw`. A cap that recently changed is where an off-by-one lives, and
 * nothing pinned the edge — no test nested 255, 256 or 257 anything.
 *
 * Two separate questions, and only the first is about the number:
 *
 * 1. **Where does it fall?** Measured: 257 nested components render, 258 refuse. `depth` is
 *    zero-based, so the outermost is 0 and the cap admits 0 through 256 inclusive.
 * 2. **Does the message describe that?** At the throw `depth` is 257, so "exceeded 256 levels" is
 *    true. It is worth pinning together with the number, because changing `>` to `>=` moves the
 *    boundary while leaving the sentence looking correct.
 *
 * The refusal exists because a cycle recurses without bound and on a server that is a hung request.
 * The message says so, and says the browser has no such limit — a claim `@verajs/ssr`'s README
 * carries, so it is asserted here rather than trusted.
 *
 * A 257-deep render costs about 8 ms.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToString } from '@verajs/ssr/vera';

const fixture = new URL('./fixtures/ssr/deep-nest.js', import.meta.url);
const renderToDepth = async (stop) => {
  process.env.VERA_SSR_DEPTH = String(stop);
  return renderToString(fixture);
};

test('257 nested components render', async () => {
  const { html } = await renderToDepth(256);
  const tags = (html.match(/<deep-nest/g) ?? []).length;

  assert.equal(tags, 257, 'the outermost is depth 0, so a cap of 256 admits 257 elements');
  assert.match(html, /leaf 256/, 'and the innermost actually rendered');
});

test('and 258 are refused rather than rendered', async () => {
  await assert.rejects(
    () => renderToDepth(257),
    (error) => {
      assert.match(error.message, /exceeded 256 levels/, 'names the cap it enforced');
      assert.match(error.message, /renders itself/, 'and the cause it exists for');
      /** The README makes this promise, so a change to it should fail here too. */
      assert.match(error.message, /browser, which has no such limit/, 'and the client difference');
      return true;
    }
  );
});

/** One below the edge, so a boundary that moves by one is caught from both sides. */
test('the boundary is exactly there, not near it', async () => {
  const { html } = await renderToDepth(255);
  assert.equal((html.match(/<deep-nest/g) ?? []).length, 256, '256 elements still render');
});
