/**
 * **Wait for CI to pass on the commit being released, and refuse otherwise** (`release.yml`, 2026-11-21).
 *
 *   node scripts/wait-for-ci.mjs      # in release.yml; reads GITHUB_REPOSITORY and GITHUB_SHA
 *
 * The release job used to publish beside CI, so `@verajs/ssr` 0.3.3 reached npm while CI was red. It stays a `push` job
 * (the identity npm's trusted-publisher binding was made for) and polls CI's run on the very commit it publishes:
 *
 * - **no run listed yet** is waiting, never passing: CI's run can appear after this job starts;
 * - **the newest run decides** (the highest id), in its latest attempt: a run re-run after a failure is in progress
 *   again, and an older run's green says nothing about it;
 * - **anything but success fails**, a red rotated fuzz seed included: CI walks fresh seeds every run, and a red one is a
 *   find, so the message says to replay it rather than re-run CI;
 * - **no answer from `gh`** is waiting too, and after the last attempt the job fails: nothing is published unproven.
 *
 * A version commit's CI is green only once its tags exist (`tag-release.mjs --check`), so the commit and its tags are
 * pushed together in one atomic push (docs/RELEASING.md): a commit pushed before its tags would wait here on a red run.
 * `VERA_CI_GH` (a script run with node, in place of `gh`), `VERA_CI_WAIT_MS` and `VERA_CI_WAIT_ATTEMPTS` exist for
 * `tests/wait-for-ci.test.mjs`, which drives every branch offline.
 */
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * **What one listing of CI's runs on the commit means.**
 *
 * @param {unknown} runs `gh run list --json databaseId,attempt,status,conclusion` output, parsed
 * @param {string} sha The commit
 * @returns {{ verdict: 'wait' | 'pass' | 'fail', line: string }}
 */
export const decide = (runs, sha) => {
  if (!Array.isArray(runs) || runs.length === 0) return { verdict: 'wait', line: `CI has no run on ${sha} yet` };
  const run = runs.reduce((newest, each) => (each.databaseId > newest.databaseId ? each : newest));
  const which = `CI run ${run.databaseId} (attempt ${run.attempt})`;
  if (run.status !== 'completed') return { verdict: 'wait', line: `${which} is ${run.status}` };
  if (run.conclusion === 'success') return { verdict: 'pass', line: `${which} passed on ${sha}` };
  return {
    verdict: 'fail',
    line:
      `${which} did not pass on ${sha} (${run.conclusion}): nothing is published. A red rotated fuzz seed blocks the ` +
      'release too: replay the seeds its log names (VERA_FUZZ_SEEDS=…), fix, and push the fix; never re-run CI until green.',
  };
};

/** One listing from `gh` (or the test's stand-in): the parsed runs, or `undefined` when it gave no answer. */
const list = (repo, sha) => {
  const stand = process.env.VERA_CI_GH;
  const args = ['run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--commit', sha, '--event', 'push', '--json', 'databaseId,attempt,status,conclusion'];
  const run = stand ? spawnSync(process.execPath, [stand, ...args], { encoding: 'utf8' }) : spawnSync('gh', args, { encoding: 'utf8' });
  if (run.status !== 0) return { error: (run.stderr || run.error?.message || `exit ${run.status}`).trim().split('\n')[0] };
  try {
    return { runs: JSON.parse(run.stdout) };
  } catch {
    return { error: `unreadable answer: ${run.stdout.slice(0, 80)}` };
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * **How long the wait lasts: 120 polls 30 s apart, 60 minutes**, longer than CI's cap (`ci.yml`'s `timeout-minutes`)
 * plus the time its jobs sit queued, and shorter than this job's own cap (`release.yml`'s) less the steps around the
 * wait. `tests/ci-timeouts.test.mjs` reads all three and holds those two margins, so a cap raised alone goes red.
 */
export const WAIT_ATTEMPTS = 120;
export const WAIT_MS = 30000;

/**
 * **Polls until CI's newest run on `sha` completes**: 0 when it succeeded, 1 otherwise or when it never finished.
 *
 * @param {{ repo: string, sha: string, attempts?: number, ms?: number, say?: (line: string) => void }} options
 * @returns {Promise<0 | 1>}
 */
export const waitForCi = async ({ repo, sha, attempts = WAIT_ATTEMPTS, ms = WAIT_MS, say = console.log }) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const answer = list(repo, sha);
    const { verdict, line } = answer.error === undefined ? decide(answer.runs, sha) : { verdict: 'wait', line: `gh gave no answer: ${answer.error}` };
    if (verdict === 'pass') {
      say(line);
      return 0;
    }
    if (verdict === 'fail') {
      say(`::error::${line}`);
      return 1;
    }
    say(`${line}; waiting (${attempt}/${attempts})`);
    if (attempt < attempts) await sleep(ms);
  }
  say(`::error::CI on ${sha} did not finish within ${attempts} attempts: nothing is published`);
  return 1;
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { GITHUB_REPOSITORY: repo, GITHUB_SHA: sha } = process.env;
  if (!repo || !sha) {
    console.error('wait-for-ci: GITHUB_REPOSITORY and GITHUB_SHA name the commit; both are set in a workflow run');
    process.exit(1);
  }
  const attempts = Number(process.env.VERA_CI_WAIT_ATTEMPTS ?? WAIT_ATTEMPTS);
  const ms = Number(process.env.VERA_CI_WAIT_MS ?? WAIT_MS);
  process.exit(await waitForCi({ repo, sha, attempts, ms }));
}
