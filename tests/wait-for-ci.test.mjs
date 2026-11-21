/**
 * **The release waits for CI's newest run on its commit, and publishes only after it succeeded** (`scripts/wait-for-ci.mjs`,
 * 2026-11-21). Every branch is driven offline: `decide` on listings, and the whole script against a stand-in for `gh`
 * that answers from a script of listings, one per poll, so each row shows the poll count it took to decide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decide } from '../scripts/wait-for-ci.mjs';

const SHA = 'abc1234';
const SCRIPT = fileURLToPath(new URL('../scripts/wait-for-ci.mjs', import.meta.url));
const done = (databaseId, conclusion, attempt = 1) => ({ databaseId, attempt, status: 'completed', conclusion });
const running = (databaseId, attempt = 1) => ({ databaseId, attempt, status: 'in_progress', conclusion: '' });

test('decide: no run is waiting, never passing; the newest run decides, in its latest attempt', () => {
  assert.equal(decide([], SHA).verdict, 'wait');
  assert.equal(decide(null, SHA).verdict, 'wait');
  assert.equal(decide([done(1, 'success')], SHA).verdict, 'pass');
  assert.equal(decide([done(1, 'success'), running(2)], SHA).verdict, 'wait', 'an older green says nothing of the newer run');
  assert.equal(decide([running(2), done(1, 'success')], SHA).verdict, 'wait', 'whatever order gh lists them in');
  assert.equal(decide([running(1, 2)], SHA).verdict, 'wait', 'a run re-run after a failure is in progress again');
  assert.match(decide([running(1, 2)], SHA).line, /attempt 2/);
});

test('decide: anything but success fails, and the message says a red rotated fuzz seed blocks the release', () => {
  for (const conclusion of ['failure', 'timed_out', 'action_required', 'startup_failure', 'skipped', '']) {
    const { verdict, line } = decide([done(7, conclusion)], SHA);
    assert.equal(verdict, 'fail', conclusion);
    assert.match(line, /nothing is published/);
    assert.match(line, /rotated fuzz seed/);
    assert.match(line, /never re-run CI until green/);
  }
});

/** Runs the script against a `gh` that answers `answers[n]` at the n-th poll (`'!'` is a failed call). */
const drive = (answers, attempts = 6) => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-ci-wait-'));
  try {
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(answers));
    writeFileSync(join(dir, 'count'), '0');
    writeFileSync(
      join(dir, 'gh.mjs'),
      `import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
const at = Number(readFileSync(${JSON.stringify(join(dir, 'count'))}, 'utf8'));
writeFileSync(${JSON.stringify(join(dir, 'count'))}, String(at + 1));
appendFileSync(${JSON.stringify(join(dir, 'args'))}, process.argv.slice(2).join(' ') + '\\n');
const answers = JSON.parse(readFileSync(${JSON.stringify(join(dir, 'answers.json'))}, 'utf8'));
const answer = answers[Math.min(at, answers.length - 1)];
if (answer === '!') { process.stderr.write('HTTP 502\\n'); process.exit(1); }
process.stdout.write(JSON.stringify(answer));
`
    );
    const env = { ...process.env, VERA_CI_GH: join(dir, 'gh.mjs'), VERA_CI_WAIT_MS: '0', VERA_CI_WAIT_ATTEMPTS: String(attempts), GITHUB_REPOSITORY: 'vera-js/vera', GITHUB_SHA: SHA };
    const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env, timeout: 30000 });
    return { status: run.status, out: run.stdout + run.stderr, polls: Number(readFileSync(join(dir, 'count'), 'utf8')), args: readFileSync(join(dir, 'args'), 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('the script: not listed, then running, then green — passes at the poll that saw it, asking for this commit only', () => {
  const { status, out, polls, args } = drive([[], [running(5)], [done(5, 'success')]]);
  assert.equal(status, 0, out);
  assert.equal(polls, 3);
  assert.match(out, /CI has no run on abc1234 yet; waiting \(1\/6\)/);
  assert.match(out, /CI run 5 \(attempt 1\) passed on abc1234/);
  assert.match(args.split('\n')[0], /^run list --repo vera-js\/vera --workflow ci\.yml --commit abc1234 --event push --json databaseId,attempt,status,conclusion$/);
});

test('the script: a red run fails at once, naming the rotated-seed rule', () => {
  const { status, out, polls } = drive([[running(5)], [done(5, 'failure')], [done(5, 'success')]]);
  assert.equal(status, 1, out);
  assert.equal(polls, 2, 'it stops at the red, never polling on for a later green');
  assert.match(out, /::error::CI run 5 \(attempt 1\) did not pass on abc1234 \(failure\): nothing is published/);
});

test('the script: a re-run in progress waits, and its green passes', () => {
  const { status, polls } = drive([[running(5, 2)], [done(5, 'success', 2)]]);
  assert.equal(status, 0);
  assert.equal(polls, 2);
});

test('the script: gh failing is waiting, and a run that never finishes fails after the last attempt', () => {
  const flaky = drive(['!', [done(5, 'success')]]);
  assert.equal(flaky.status, 0, flaky.out);
  assert.match(flaky.out, /gh gave no answer: HTTP 502; waiting \(1\/6\)/);
  const never = drive([[running(5)]], 3);
  assert.equal(never.status, 1);
  assert.equal(never.polls, 3);
  assert.match(never.out, /::error::CI on abc1234 did not finish within 3 attempts: nothing is published/);
  const empty = drive([[]], 3);
  assert.equal(empty.status, 1, 'no run ever listed never passes');
});

test('release.yml runs the wait before it builds or publishes, with permission to read CI', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const wait = workflow.indexOf('run: node scripts/wait-for-ci.mjs');
  assert.ok(wait > workflow.indexOf('uses: actions/checkout'), 'after the checkout that brings the script');
  assert.ok(wait < workflow.indexOf('run: npm ci') && wait < workflow.indexOf('run: npx changeset publish') && workflow.includes('run: npx changeset publish'), 'before anything is built or published');
  assert.match(workflow, /actions: read/);
});
