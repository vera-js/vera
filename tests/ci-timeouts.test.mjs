/**
 * **The release's wait outlasts CI, and fits inside the release job** (2026-11-21). Three numbers in three files are one
 * budget: CI's job cap (`ci.yml`'s `timeout-minutes`), the wait (`scripts/wait-for-ci.mjs`: `WAIT_ATTEMPTS` polls
 * `WAIT_MS` apart) and the release job's cap (`release.yml`'s). A wait shorter than CI's cap plus the time CI's jobs sit
 * queued gives up on a run still allowed to pass, and fails a good release; a release cap shorter than the wait plus the
 * steps around it kills the job mid-wait. Raising one cap alone breaks one of the two, so this reads all three.
 *
 * The margins are measured, never guessed (GitHub's API, the run's `createdAt` to each job's `startedAt`, and each
 * release step's own times): QUEUE_MINUTES is the longest a CI job waited for a runner, POLL_SECONDS the longest one
 * `gh run list` took, and AROUND_MINUTES the release job's steps before and after the wait together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WAIT_ATTEMPTS, WAIT_MS } from '../scripts/wait-for-ci.mjs';

/**
 * MEASURED on 2026-11-21, each rounded UP to the whole unit: 18 CI jobs of 15 green runs on main waited 2–3 s for a
 * runner, but one waited 11.2 minutes; one wait polled 48 times 30.42–30.63 s apart; and of 10 release runs the steps
 * before the wait took at most 0.07 minutes and the steps after it (npm, install, build, publish) at most 4.47.
 */
const QUEUE_MINUTES = 12;
const POLL_SECONDS = 1;
const AROUND_MINUTES = 5;

/** The one `timeout-minutes` in a workflow: exactly one, or the reading is not of the cap this test means. */
const capOf = (file) => {
  const caps = [...readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8').matchAll(/^\s+timeout-minutes:\s*(\d+)\s*$/gm)];
  assert.equal(caps.length, 1, `${file} holds exactly one timeout-minutes (it has ${caps.length})`);
  return Number(caps[0][1]);
};

/** Every margin the budget breaks, in words; empty when it holds. */
const broken = ({ ci, attempts, ms, release }) => {
  const shortest = (attempts * ms) / 60000;
  const longest = (attempts * (ms + POLL_SECONDS * 1000)) / 60000;
  const problems = [];
  if (shortest < ci + QUEUE_MINUTES) problems.push(`the wait (${shortest} min) ends before CI's cap (${ci}) plus its queue (${QUEUE_MINUTES})`);
  if (release < longest + AROUND_MINUTES) problems.push(`the release cap (${release}) ends before the longest wait (${longest} min) plus the steps around it (${AROUND_MINUTES})`);
  return problems;
};

test('the wait outlasts CI plus its queue, and the release job outlasts the wait plus its other steps', () => {
  const actual = { ci: capOf('ci.yml'), attempts: WAIT_ATTEMPTS, ms: WAIT_MS, release: capOf('release.yml') };
  assert.deepEqual(broken(actual), [], JSON.stringify(actual));
  /** CONTROLS: each margin can fail, by its own message — CI's cap raised alone, then the release cap lowered alone. */
  assert.match(broken({ ...actual, ci: actual.ci + 30 }).join('\n'), /ends before CI's cap/);
  assert.match(broken({ ...actual, release: actual.release - 30 }).join('\n'), /the release cap/);
});
