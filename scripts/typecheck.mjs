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
 * Each package gets its own pass, then the root config gets one more. The root config is not a
 * duplicate: its `include` covers `examples/` and `tests/types/`, and its `paths` aliases resolve
 * every bare specifier to that package's `src`. So the root pass is what checks the API surface as
 * a consumer actually sees it, across package boundaries, rather than each package in isolation.
 *
 * `tests/types/public-api.ts` rides on that pass. It is type-level only — it never runs — and it
 * exists because the `.mjs` suites test built JavaScript and so cannot see the `.d.ts` layer at
 * all. `ref` shipped returning `{ value: T } | { value: { value: T } }` for exactly that long.
 */
import { globSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

/**
 * `tests/consumer` is last and is **not** a duplicate of the root pass. The root config aliases every
 * bare specifier to that package's `src` through `paths`, which is what makes it a cross-boundary
 * check and also what makes it blind to the `.d.ts` files a consumer installs. That config has no
 * `paths`, so imports resolve through `exports` -> `types` exactly as npm resolves them — and it
 * requires a build, because there is nothing to resolve to otherwise.
 */
const configs = [...globSync('packages/*/tsconfig.json').sort(), 'tsconfig.json', 'tests/consumer/tsconfig.json'];
let failed = 0;

for (const config of configs) {
  const pkg =
    config === 'tsconfig.json'
      ? 'root (examples + tests/types)'
      : config === 'tests/consumer/tsconfig.json'
        ? 'consumer (shipped .d.ts)'
        : config.split('/')[1];
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
console.log(`\n${configs.length} configs type-check clean.`);
