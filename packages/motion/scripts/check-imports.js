/**
 * Verifies every named import resolves to something the target actually exports.
 *
 * This exists because of a specific silent failure. Under Vitest a dangling
 * named import — `import { deletedThing } from './x.js'` — resolves to
 * `undefined` rather than throwing, so a test importing something since
 * renamed or removed keeps passing. That is how a stale `BREAKPOINTS` import
 * survived the breakpoint redesign: 644 tests green, one of them importing a
 * constant that no longer existed.
 *
 * `tsc --noEmit` does not catch it. `src` is typechecked but the tests are
 * `.js` with `checkJs` off, and turning `checkJs` on produces ~860 errors —
 * almost all strictness noise from fixtures deliberately passing loose values,
 * which would bury the one error worth seeing. A narrower tsconfig still left
 * 253. So: a purpose-built check, no noise, one class of error.
 *
 * That narrower tsconfig stayed in the repository as `tsconfig.test.json`,
 * referenced by nothing — a plausible-looking file implying the tests were
 * typechecked when no script ran it. Re-measured 2026-08-28 before deleting
 * it, in case it had become viable: **524 errors**, worse than when it was
 * rejected. Removed.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every source and test file, recursively. */
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(ts|js|mjs)$/.test(entry.name) ? [path] : [];
  });

const FILES = [...walk(resolve(root, 'src')), ...walk(resolve(root, 'test'))];

/** `import { a, b as c } from 'x'` and `import type { … } from 'x'`. */
const IMPORTS = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;

/**
 * What a module exports by name.
 *
 * Deliberately regex rather than a parser: the codebase writes exports one way
 * — `export const`, `export function`, `export interface`, `export type`, or a
 * re-export list — and a parser dependency would cost more than it catches.
 */
const exportsOf = (file) => {
  const source = readFileSync(file, 'utf8');
  const names = new Set();
  for (const [, name] of source.matchAll(/^export\s+(?:declare\s+)?(?:const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/gm)) {
    names.add(name);
  }
  /** `export { a, b as c }`, with or without a `from` clause. */
  for (const [, list] of source.matchAll(/^export\s+(?:type\s+)?\{([^}]*)\}/gm)) {
    for (const part of list.split(',')) {
      const alias = part.trim().split(/\s+as\s+/);
      const name = (alias[1] ?? alias[0] ?? '').trim();
      if (name) names.add(name);
    }
  }
  if (/^export\s+default/m.test(source)) names.add('default');
  /** `export * from './x'` re-exports everything that module has. */
  for (const [, target] of source.matchAll(/^export\s+\*\s+from\s*['"]([^'"]+)['"]/gm)) {
    const resolved = resolveSpecifier(file, target);
    if (resolved) for (const name of exportsOf(resolved)) names.add(name);
  }
  return names;
};

/** `./x.js` in source resolves to `./x.ts` on disk; both spellings appear. */
const resolveSpecifier = (from, specifier) => {
  if (!specifier.startsWith('.')) return null;
  const base = resolve(dirname(from), specifier);
  for (const candidate of [base, base.replace(/\.js$/, '.ts'), `${base}.ts`, `${base}.js`]) {
    if (existsSync(candidate) && !candidate.endsWith('/')) return candidate;
  }
  return null;
};

let failures = 0;
for (const file of FILES) {
  const source = readFileSync(file, 'utf8');
  for (const [, list, specifier] of source.matchAll(IMPORTS)) {
    const target = resolveSpecifier(file, specifier);
    if (!target) continue;
    const available = exportsOf(target);
    /**
     * A name bound twice in one clause is an early error in the spec, and Node
     * refuses to load the file — but esbuild, which Vitest transforms with,
     * accepts it silently. `test/schema.test.js` imported SETTINGS twice and
     * ran for as long as nobody tried it under a plain ESM loader.
     */
    const bound = new Set();
    for (const part of list.split(',')) {
      const [source, alias] = part.trim().split(/\s+as\s+/);
      const name = source?.trim();
      const local = (alias ?? source)?.trim();
      if (!name) continue;
      if (local && bound.has(local)) {
        console.error(
          `${file.replace(`${root}/`, '')}: binds "${local}" twice in one import from ${specifier}` +
          ' — a syntax error under Node, silently accepted by esbuild'
        );
        failures++;
      }
      if (local) bound.add(local);
      if (available.has(name)) continue;
      console.error(
        `${file.replace(`${root}/`, '')}: imports "${name}" from ${specifier}, which does not export it`
      );
      failures++;
    }
  }
}

if (failures) {
  console.error(`\ncheck-imports: ${failures} dangling import(s).`);
  process.exit(1);
}
console.log(`check-imports: ${FILES.length} files, every named import resolves.`);
