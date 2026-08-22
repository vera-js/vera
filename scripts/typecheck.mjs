/**
 * Type-check every buildable package.
 *
 *   node scripts/typecheck.mjs
 *
 * The build uses `@rollup/plugin-typescript`, which transpiles but does not fail on type errors —
 * so before this existed the type layer gated nothing. A real error sat in `hydrate.ts` for an
 * unknown period: `nextSibling` annotated as `Node` where the surrounding code needed `ChildNode`,
 * caught only by running `tsc` by hand during the 2026-08-22 testing audit.
 *
 * Packages only, deliberately. `examples/` currently has 24 type errors of its own (see
 * `internal/docs/audits/testing.md`); gating on them would either block CI or force a rushed pass
 * over `goodbye-component.ts`, which CLAUDE.md flags as the most valuable test component in the
 * repo. Examples get their own gate once that is done properly.
 */
import { globSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const configs = globSync('packages/*/tsconfig.json').sort();
let failed = 0;

for (const config of configs) {
  const pkg = config.split('/')[1];
  try {
    execFileSync('npx', ['tsc', '--noEmit', '-p', config], { encoding: 'utf8', stdio: 'pipe' });
    console.log(`  ✓ ${pkg}`);
  } catch (error) {
    failed++;
    console.error(`  ✗ ${pkg}`);
    console.error((error.stdout || error.message).trim().split('\n').map((l) => `      ${l}`).join('\n'));
  }
}

if (failed) {
  console.error(`\n${failed} package(s) failed type-checking.`);
  process.exit(1);
}
console.log(`\n${configs.length} packages type-check clean.`);
