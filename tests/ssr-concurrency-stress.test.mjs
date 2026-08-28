/**
 * **The acceptance gate for making the render asynchronous.**
 *
 * A server render is synchronous end to end today, and that is what makes two `renderToString` calls
 * safe: the per-render bookkeeping — `renderedTags`, `renderErrors`, `pendingInstances`,
 * `instanceCount`, the style-hoisting state — is **module-level**, and nothing can interleave to see
 * another request's copy of it. `internal/docs/PLAN-ssr-async-render.md` is about removing that
 * guarantee's underpinning on purpose, so this exists to say loudly if it is lost.
 *
 * The existing isolation suite next door pins five specific defects. This one is shaped differently
 * on purpose: **many renders, deliberately interleaved, compared against their own serial
 * baselines.** Cross-request contamination is not a failure any single-render test can see — the
 * markup is individually plausible, it is only wrong *relative to what that request asked for* — so
 * the baseline comparison is the whole assertion.
 *
 * It passes today. It is written to fail if an async render ever lets one request see another's
 * state, which is the failure mode with the worst reproduction story available: intermittent, only
 * under load, and shaped like a bug in the component rather than the renderer.
 */
import { renderToString } from '@verajs/ssr/vera';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const fixture = (name) => new URL(`./fixtures/ssr/${name}`, import.meta.url);

/** A spread of shapes, chosen so each exercises a different piece of the shared bookkeeping. */
const SUBJECTS = [
  { file: 'hello-ssr.js', tag: 'hello-ssr' },
  { file: 'rows-ssr.js', tag: 'rows-ssr' },
  /** Two components racing to register — the defect the isolation suite next door was built on. */
  { file: 'race-a-ssr.js', tag: undefined },
  { file: 'race-b-ssr.js', tag: undefined },
  /** Nesting, which is what `renderedTags` and `pendingInstances` are for. */
  { file: 'nested-ssr.js', tag: 'nested-ssr' },
  /**
   * **Light-DOM components that hoist CSS.** These are the subjects that matter most: the hoisting
   * state decides whether a request carries its own styles, and a leak means the *second* request
   * renders without CSS the first one took. Chosen because they actually produce hoisted output —
   * `static styles` in a shadow root does not, so those fixtures could not see this at all.
   */
  { file: 'styled-a-ssr.js', tag: undefined },
  { file: 'styled-b-ssr.js', tag: undefined },
  { file: 'island-a-ssr.js', tag: undefined },
  { file: 'light-dom-ssr.js', tag: undefined },
  /**
   * **Purpose-built, because nothing else reached these.** `head-style-ssr` appends its own
   * `<style>` on every render, which is the only shape that reaches the once-per-render hoisting
   * guard more than once — `static styles` hoists once per class *ever* and so cannot see it;
   * `pending-instance-ssr` leaves a marked component instance inside a `<template>` the scan never
   * walks, which is the state `pendingInstances.clear()` exists to stop one request handing on.
   * Both were added after deliberately breaking each piece of state and watching this suite pass.
   */
  /** Appends its own `<style>` per render rather than using `static styles`, so it reaches the
   *  hoisting path directly. See the note below about what that state can and cannot show. */
  { file: 'head-style-ssr.js', tag: 'head-style-ssr' },
  { file: 'pending-instance-ssr.js', tag: 'pending-instance-ssr' },
];

/**
 * **The whole result, not just the markup.** `renderedTags` decides which hoisted styles a response
 * carries, so a leak in it shows up in `styles` and nowhere else — comparing only `html` made this
 * suite blind to the single piece of shared state most likely to cross between requests. Found by
 * deliberately breaking each one and watching this pass anyway.
 */
const render = async ({ file, tag, attrs }) => {
  const options = { ...(tag ? { tag } : {}), ...(attrs ? { attributes: attrs } : {}) };
  const { html, styles, title } = await renderToString(fixture(file), Object.keys(options).length ? options : undefined);
  return JSON.stringify({ html, styles, title });
};

/** Two entries can share a file, so the baseline is keyed by the subject rather than the filename. */
const keyOf = (subject) => subject.key ?? subject.file;

/** One at a time, with nothing else in flight — the answer every concurrent run has to match. */
const baselines = new Map();
for (const subject of SUBJECTS) baselines.set(keyOf(subject), await render(subject));

/**
 * **What this suite can and cannot see, established by breaking each piece of state on purpose.**
 *
 * Caught: `renderedTags` (all three tests fail) and `renderErrors` (one fails). Those are the two
 * that reach the response — `renderedTags` decides which hoisted styles it carries, which is why
 * this compares the whole result rather than only `html`. Comparing markup alone was blind to it.
 *
 * **Provably not caught, and not a gap in the test:** clearing `hoistedThisRender` and
 * `pendingInstances` has no observable effect today. `hoist` de-duplicates by text, so a component
 * emitting the same CSS twice changes nothing — and one emitting *different* CSS per request is
 * ignored anyway by the once-per-class-ever rule, which establishes a tag's sheets from whichever
 * render reached it first and keeps them. Both clears are belt-and-braces for the current design.
 *
 * That matters for the async work: those two are exactly the state that would *start* mattering
 * once renders can interleave, and **this suite cannot prove they are safe**. Anything that makes
 * the render asynchronous has to reason about them directly rather than trusting a green run here.
 */
test('every subject renders identically no matter what else is in flight', async () => {
  /** Enough overlap that any shared mutable state has a real chance to be seen by the wrong one. */
  const ROUNDS = 12;
  const jobs = [];
  for (let round = 0; round < ROUNDS; round++)
    for (const subject of SUBJECTS)
      jobs.push(render(subject).then((result) => [keyOf(subject), result]));

  const results = await Promise.all(jobs);
  assert.equal(results.length, ROUNDS * SUBJECTS.length, 'every render completed');

  const wrong = results.filter(([key, result]) => result !== baselines.get(key));
  assert.deepEqual(
    wrong.map(([file]) => file),
    [],
    `${wrong.length} of ${results.length} concurrent renders differ from their serial baseline — ` +
      `one request saw another's state`
  );
});

/**
 * The same, with failures mixed in. A render that throws leaves the shared error list and the
 * instance registry mid-flight, so a *successful* render overlapping it is the one at risk.
 */
test('a failing render does not disturb the ones beside it', async () => {
  const failing = () => renderToString(fixture('throws-ssr.js'), { tag: 'throws-ssr' });
  const jobs = [];
  for (let round = 0; round < 8; round++) {
    for (const subject of SUBJECTS) jobs.push(render(subject).then((result) => [keyOf(subject), result]));
    jobs.push(failing().then(() => ['throws', 'DID NOT THROW'], () => ['throws', 'threw']));
  }

  const results = await Promise.all(jobs);
  const failures = results.filter(([file]) => file === 'throws');
  assert.equal(failures.length, 8, 'every failing render was attempted');
  assert.ok(
    failures.every(([, outcome]) => outcome === 'threw'),
    'a failing render must still fail when others are in flight'
  );

  const wrong = results.filter(([key, result]) => key !== 'throws' && result !== baselines.get(key));
  assert.deepEqual(wrong.map(([file]) => file), [], 'a failure beside them changed their markup');
});

/** And a serial render afterwards is still what it was, so nothing was left behind. */
test('the shared state is clean once the storm passes', async () => {
  for (const subject of SUBJECTS)
    assert.equal(
      await render(subject),
      baselines.get(keyOf(subject)),
      `${subject.file} changed after concurrent renders — state leaked between requests`
    );
});
