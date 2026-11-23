/**
 * **The browser suite on every engine, each run even when an earlier one failed** (2026-11-23). The steps were chained
 * with `&&`, so a Firefox red skipped WebKit in the gate and in CI and its result was never read. Each engine is its own
 * `test-batch.mjs` run, as before; the exit is non-zero when any engine failed, and the failed engines are named last.
 * Node, not a shell `;`/`exit $r` form, which `cmd` (npm on Windows) does not run.
 */
import { spawnSync } from 'node:child_process';

const failed = [];
for (const engine of ['chromium', 'firefox', 'webkit']) {
  const run = spawnSync(process.execPath, ['scripts/test-batch.mjs', '--light', `VERA_BROWSERS=${engine}`, 'web-test-runner', '--config', 'web-test-runner.config.mjs'], { stdio: 'inherit' });
  if (run.status !== 0) failed.push(`${engine} (${run.status ?? run.signal})`);
}
if (failed.length > 0) {
  console.error(`browser suite failed on: ${failed.join(', ')}`);
  process.exit(1);
}
