/**
 * **A name that moved packages, which the removed-APIs list structurally cannot express.**
 *
 * `tests/docs-removed-apis.test.mjs` is keyed by name, and adding `render` to it would flag every
 * correct mention of core's `render` — which is most of the documentation. But the renderer's
 * imperative draw *was* `render` until 0.2.0, and core's is a different function with a different
 * arity that is still called `render`. One name, two packages, only one of them renamed.
 *
 * Two rules, because the first is exact and the second reaches where it cannot:
 *
 * 1. **Nothing binds `render` from a renderer entry.** A static import, a dynamic `await import`,
 *    or a destructured `load('renderer')` — the specifier is what identifies the function, not the
 *    call. This is airtight for code and it does not care how the call is written.
 * 2. **No prose teaches `render(result, container)`.** Documentation shows calls without showing
 *    imports, so a fragment in a README has no binding to check. The two-argument shape is
 *    unambiguous: core's `render` takes a template function and no container.
 *
 * Rule 1 exists because rule 2 was written first and missed real cases — a multi-line call, and a
 * `const { render } = skip ? {} : await load(…)`. Matching call *shapes* is guesswork; matching the
 * import is not. Rule 2 stays because it covers prose, where there is no import to match.
 *
 * The general lesson, and the reason this is a file rather than a careful grep: a rename a
 * name-keyed list cannot express needs its own check written the same day, or the prose half of it
 * is verified once by hand and never again. `setRenderer` survived its own deletion in 23 places
 * with every suite green.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relative } from 'node:path';
import { walkFiles, readIfPresent } from './walk.mjs';

const root = new URL('..', import.meta.url).pathname;

/**
 * A renderer entry, however it is spelled: bare specifier, dist path, or `load()` key.
 *
 * The last alternative is load-bearing and was missing at first, which made this whole rule inert —
 * `load('renderer')` hands over the key `renderer`, with no scope and no filename, so a pattern
 * requiring `@verajs/` or `vera-` matched none of the ~36 suites that resolve their artifact that
 * way. The rule passed on every one of them. It was found by reintroducing the old binding on
 * purpose and watching the test **not** fail; a green check nobody has seen go red is not evidence.
 */
const RENDERER_SOURCE = /^renderer(?:\/|$)|@verajs\/renderer|vera-renderer|packages\/renderer\//;

/** `import { … } from '<spec>'`, `await import('<spec>')`, `await load('renderer…')`. */
const BINDING = new RegExp(
  String.raw`\{([^}]*)\}\s*=?\s*(?:from\s*)?` +
    String.raw`(?:['"]([^'"]*)['"]|await\s+import\(\s*['"]([^'"]*)['"]|.*?await\s+load\(\s*['"](renderer[^'"]*)['"])`,
  'g'
);

/** The renderer's call form: something, then a container. Core's takes neither. */
const TWO_ARG = /(?<![\w$.])render\(.*,\s*(?:host|container|el|element|root|node|target)\w*\s*\)/;

/** A line explaining the rename rather than teaching the old name. */
const HISTORICAL = /\b(was|were|used to|no longer|renamed|previously|until|before)\b/i;

/**
 * `bench/` holds **other frameworks' source verbatim** — Preact, Lit, Vue and React each export
 * their own `render`, and rewriting theirs would break the comparison this repo's performance claims
 * rest on. Vera's own bench code is covered by rule 1 like everything else.
 */
const FOREIGN_RENDER = new Set(['bench/size.mjs', 'bench/dom/impls.js', 'bench/renderer-vs-lit.mjs']);

const files = [];
files.push(
  ...walkFiles(root, /\.(md|txt|html|js|jsx|mjs|ts|tsx)$/, {
    ignore: ['node_modules', 'dist', 'internal', '.changeset'],
    skipDotDirs: true,
  }).filter((file) => !/CHANGELOG/i.test(file))
);

const self = (file) => file.endsWith('docs-moved-render.test.mjs');

test('nothing binds `render` from a renderer entry', () => {
  assert.ok(files.length > 10, `expected to find the tree, found ${files.length}`);
  const problems = [];
  for (const file of files) {
    if (self(file)) continue;
    const text = readIfPresent(file);
    if (text === null) continue;
    for (const match of text.matchAll(BINDING)) {
      const [clause, ...specifiers] = [match[1], match[2], match[3], match[4]];
      const specifier = specifiers.find(Boolean);
      if (!specifier || !RENDERER_SOURCE.test(specifier)) continue;
      /** `render as something` is a local alias and binds no name called `render`. */
      if (!/(?<![\w$])render\s*(?![\w$]|\s+as\b|\s*:)/.test(clause)) continue;
      const line = text.slice(0, match.index).split('\n').length;
      problems.push(`${relative(root, file)}:${line}  { ${clause.trim()} } from ${specifier}`);
    }
  }
  assert.deepEqual(problems, [], `the renderer's draw is \`renderInto\`:\n  ${problems.join('\n  ')}`);
});

test('no prose teaches `render(result, container)`', () => {
  const problems = [];
  for (const file of files) {
    const relativePath = relative(root, file);
    if (self(file) || FOREIGN_RENDER.has(relativePath)) continue;
    const text = readIfPresent(file);
    if (text === null) continue;
    text
      .split('\n')
      .forEach((line, i) => {
        if (TWO_ARG.test(line) && !HISTORICAL.test(line)) problems.push(`${relativePath}:${i + 1}  ${line.trim()}`);
      });
  }
  assert.deepEqual(problems, [], `these teach the old name:\n  ${problems.join('\n  ')}`);
});
