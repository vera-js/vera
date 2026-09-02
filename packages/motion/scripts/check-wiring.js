/**
 * Does a **built** module's refusal reach a **built** instance's `rejected`?
 *
 * Every other gate here runs against `src/`, where the module graph resolves
 * `modules/rejections.js` once and every module shares the registry
 * `createMotion` reads. The published artifacts do not: each is bundled on its
 * own, so `dist/split.js` opened with `const e=new WeakMap` — its own private
 * copy — and `reject(node, reason)` wrote into a map nothing would ever read.
 *
 * A page that wired the built `@verajs/motion/split` and misspelled
 * `split="sentences"` got `["data-vera-motion-split"]` and no reason. The
 * sentence explaining it went to the console, which is the one channel
 * `CLAUDE.md` says is not a channel: a GUI editor renders
 * `instance.rejected` and cannot read a console. The nineteen tests in
 * `module-rejections.test.js` and `module-refusals-reach-rejected.test.js` cover
 * this path and all of them passed, because all of them import from `src/`.
 *
 * The modules now take `@verajs/motion` as an `external`, the way
 * `@verajs/motion/vera` already did. Run under plain Node so that
 * `import ... from '@verajs/motion'` inside an artifact resolves through the
 * package's own `exports` map — self-reference, which lands on
 * `dist/motion.js`. Vitest cannot host this check: its alias sends the
 * specifier to `src/index.ts`, which reintroduces the two-copies situation from
 * the other side and makes the result meaningless either way.
 *
 * Skipped when `dist` is missing, so this does not force a build to lint —
 * `check-types.js` sets that precedent.
 */
import { existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

if (!existsSync(join(root, 'dist', 'vera-motion.min.js'))) {
  console.log('check-wiring: no dist yet, skipped.');
  process.exit(0);
}

const { Window } = await import('happy-dom');
const window = new Window({ url: 'https://wiring.test/' });
for (const name of [
  'window', 'document', 'Element', 'HTMLElement', 'Node', 'CustomEvent',
  'getComputedStyle', 'MutationObserver', 'CSS', 'HTMLCanvasElement', 'ResizeObserver',
]) {
  globalThis[name] = window[name];
}
/** Synchronous, so `init()` has finished writing by the time it returns. */
globalThis.requestAnimationFrame = (fn) => { fn(0); return 1; };
globalThis.cancelAnimationFrame = () => {};

const { createMotion, wireMotion } = await import('@verajs/motion');
const { split } = await import('@verajs/motion/split');
const { sequence } = await import('@verajs/motion/sequence');
const { paint } = await import('@verajs/motion/paint');
const { path } = await import('@verajs/motion/path');

wireMotion([split, sequence(), paint, path]);

/**
 * Three modules and all three channels, because they do not report the same way
 * and a fix for one says nothing about the others.
 *
 * `split` calls `reject()` — the shared per-element registry, and the one that
 * had a private copy per artifact. `paint` calls `pageProblem()`, the other
 * half of the same file and the other half of the same bug; a check that
 * covered only `reject` would have let `paint` drift back on its own.
 * `sequence` returns its reason from `apply`, so it travels through core's own
 * call and was never affected — it is here so that the day someone moves it
 * onto `reject()` for symmetry, this notices.
 */
const cases = [
  {
    what: 'split, through reject()',
    /**
     * **Unmarked on purpose.** `split` carries an `allowed` list, so core
     * refuses a bad mode on any *marked* container — and this fixture used to
     * be marked, which meant it was proving core's channel rather than the
     * module's, and stopped proving anything at all the day split's own
     * refusal was gated on the absent marker to stop reporting one mistake
     * twice. An unmarked container is the case core cannot see: the bare
     * marker is optional, nothing parses the attribute, and only the module
     * can say anything. Which is exactly the crossing this check exists for.
     */
    markup: '<p data-vera-motion-split="sentences">one two</p>',
    expect: 'is not one of chars, words, lines',
  },
  {
    what: 'paint, through pageProblem()',
    /**
     * One attribute past the 1,024-slot table, which is a *page* problem rather
     * than an element's: every later value is refused, not this one. Two
     * keyframes per element, so 513 elements fills it.
     */
    markup: Array.from(
      { length: 513 },
      (_, i) =>
        `<div data-vera-motion data-vera-motion-background=` +
        `"0% rgb(${i % 256}, ${i >> 8}, 0), 100% rgb(${i % 256}, ${i >> 8}, 1)"></div>`
    ).join(''),
    expect: 'distinct paint values on this page',
  },
  {
    what: 'sequence, through the apply return',
    markup:
      '<div data-vera-motion data-vera-motion-frame="0% 0, 100% 10" ' +
      'data-vera-motion-frame-url="https://wiring.test/f-#.jpg" ' +
      'data-vera-motion-frame-count="10"></div>',
    expect: 'needs a <canvas> element',
  },
];

const warn = console.warn;
console.warn = () => {};
const failures = [];
for (const { what, markup, expect } of cases) {
  document.body.innerHTML = markup;
  const instance = createMotion({ respectReducedMotion: false, inertia: 0 });
  instance.init();
  const said = instance.rejected.flatMap((entry) => entry.rejected).join(' | ');
  instance.destroy();
  if (said.includes(expect)) {
    console.log(`  ok    ${what}`);
  } else {
    failures.push(`${what}\n        wanted a reason containing: ${expect}\n        rejected said:  ${said || '(nothing)'}`);
    console.log(`  FAIL  ${what}`);
  }
}
console.warn = warn;

if (failures.length) {
  console.error(
    `\ncheck-wiring: ${failures.length} module refusal(s) did not reach instance.rejected in the ` +
    `built artifacts.\n\n    ${failures.join('\n\n    ')}\n\n` +
    '  A module bundling its own copy of modules/rejections.js is the cause this has had before:\n' +
    "  add '@verajs/motion' to that module's rollupOptions.external and import the channel from the\n" +
    '  package rather than by relative path.\n'
  );
  process.exit(1);
}
console.log('check-wiring: module refusals reach the built instance.');
