/**
 * Typechecks a consumer against the **built** declarations.
 *
 * `npm run typecheck` checks `src/`. It says nothing about `dist/*.d.ts`,
 * which a separate `tsc -p tsconfig.build.json` emits and which is what every
 * consumer actually sees. A public type can be wrong, missing, or reference a
 * type that was not exported, and every gate here would stay green.
 *
 * `strict` and `skipLibCheck: false`, because a consumer with those on is the
 * one who finds out. Skipped when `dist` is missing, so this does not force a
 * build to lint.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'dist', 'development', 'vera-motion.d.ts'))) {
  console.log('check-types: no dist yet, skipped.');
  process.exit(0);
}

/**
 * Which names the consumer must mention, taken from the declarations rather
 * than from a list here.
 *
 * `test/types/consumer.ts` is hand-written, and the package's exports are not,
 * so the two drift the way every hand-held completeness list in this repo has
 * drifted. Eleven public names had never been
 * compiled by it: the diagnostics types `RejectedElement` and
 * `ScrollToProblem` — how a consumer finds out an attribute was refused —
 * along with `RuntimeElement`, `SettingDef`, `Category`, `Band`,
 * `CATEGORIES`, `UNITS`, `MIN_PERCENT`, `MAX_PERCENT` and
 * `resolveEasing`. The file's own comment records it having missed the whole
 * module surface once before, which is the same drift a lap earlier.
 *
 * This checks *presence*, not use — the compile above is what checks the
 * types. A name mentioned only inside a `void` satisfies it, and that is the
 * intended floor: the point is that no export can be added without this file
 * being touched.
 */
const consumer = readFileSync(join(root, 'test', 'types', 'consumer.ts'), 'utf8');
const uncompiled = [];

for (const file of readdirSync(join(root, 'dist', 'development')).filter((name) => name.endsWith('.d.ts'))) {
  const declarations = readFileSync(join(root, 'dist', 'development', file), 'utf8');
  const exported = new Set();

  for (const [, name] of declarations.matchAll(/^export declare (?:const|function|class|let|type) ([A-Za-z_$][\w$]*)/gm)) {
    exported.add(name);
  }
  for (const [, name] of declarations.matchAll(/^export (?:type|interface) ([A-Za-z_$][\w$]*)\b/gm)) {
    exported.add(name);
  }
  /** Re-export blocks, value and type, `x as y` counted under the name a consumer writes. */
  for (const [, body] of declarations.matchAll(/^export (?:type )?\{([^}]*)\}/gms)) {
    for (const part of body.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exported.add(name);
    }
  }

  for (const name of exported) {
    if (!new RegExp(`\\b${name}\\b`).test(consumer)) uncompiled.push(`${file}: ${name}`);
  }
}

if (uncompiled.length) {
  for (const line of uncompiled) console.error(`  ${line}`);
  console.error(
    `\ncheck-types: ${uncompiled.length} exported name(s) no strict consumer compiles. ` +
    'Add them to test/types/consumer.ts, or stop exporting them.'
  );
  process.exit(1);
}

try {
  /**
   * Resolved through the module system, not a hard-coded `node_modules` path — in the
   * monorepo the workspace root owns the tooling, so typescript hoists a level up.
   */
  const { createRequire } = await import('node:module');
  const tsc = join(dirname(createRequire(import.meta.url).resolve('typescript/package.json')), 'bin', 'tsc');
  execFileSync(
    process.execPath,
    [tsc, '--noEmit', '-p', join(root, 'test', 'types', 'tsconfig.json')],
    { stdio: 'pipe' }
  );
} catch (error) {
  console.error(String(error.stdout ?? '').trim() || String(error.message));
  console.error('\ncheck-types: the published declarations do not satisfy a strict consumer.');
  process.exit(1);
}

console.log('check-types: a strict consumer compiles against dist/*.d.ts, and mentions every exported name.');
