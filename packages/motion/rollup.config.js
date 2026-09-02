import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Seven builds, in **two categories**, and the difference is who may import the runtime.
 *
 * | bundle | runtime relationship | rule |
 * | --- | --- | --- |
 * | `vera-motion` | **is** the runtime | the one everything resolves to |
 * | `vera-motion-scroll-to` | none — fully standalone | load with anything |
 * | `vera-motion-easings` | none — fully standalone | load with anything |
 * | `vera-motion-paint` | imports `@verajs/motion` (external) | needs the runtime on the page |
 * | `vera-motion-path` | imports `@verajs/motion` (external) | needs the runtime on the page |
 * | `vera-motion-sequence` | imports `@verajs/motion` (external) | needs the runtime on the page |
 * | `vera-motion-split` | imports `@verajs/motion` (external) | needs the runtime on the page |
 * | `vera-motion-vera` | imports `@verajs/motion` (external) | needs the runtime on the page |
 *
 * **The runtime stays external in every mode, production included.** This is the same rule, for
 * the same reason, as `@verajs/reactivity` keeping `@verajs/core` external: the rejections
 * registry (`reject`/`pageProblem`) is module-level state `createMotion` reads, so a module that
 * bundles its own copy of the runtime writes refusals into a map nobody reads. That exact bug
 * shipped once from the Vite build — `dist/split.js` opened with its own `new WeakMap`, every
 * refusal reached the console and never `instance.rejected`, and only a check that ran the *built*
 * artifacts could see it. The wiring check (`scripts/check-wiring.js`) exists because of it.
 *
 * `scroll-to` is standalone **by design** — it imports the namespace string and nothing else, so
 * a page can use smooth scrolling without paying for the animation runtime. `easings` likewise
 * carries its own solver. Neither may grow an import of the runtime without revisiting this file.
 */
const RUNTIME = ['@verajs/motion'];

/**
 * Property mangling for the production build of the **main bundle only**, by
 * explicit list rather than core's `_`-prefix convention — these are interface
 * fields of the runtime's internal shapes (`RuntimeElement`, `ScreenPlan`,
 * `ParsedElement`), renamed nowhere in source because the suite reads them by
 * name against `src`.
 *
 * The rules for the list, all load-bearing:
 * - **Only names outside the published contract.** `instance.elements` is
 *   typed `MotionElement` — `node` + `timelinePosition` — precisely so the
 *   rest of the runtime element is private; a field promoted into that type
 *   must come off this list in the same edit. Anything a
 *   `PropertyDef`/`SettingDef`/`Insert` carries, anything `MotionOptions`
 *   takes, and anything else in `vera-motion.d.ts` must never appear here.
 * - **Only names no DOM, CSSOM or builtin surface owns.** `transition` and
 *   `position` collide with `style.*`; `size` with `Set.size`/`Map.size`.
 * - Quoted accesses are exempt (`keep_quoted` in the shared config), so a
 *   name written dynamically and read as `settings['x']` stays whole.
 *
 * `test/dist-surface.test.js` runs the built artifact against the published
 * contract, so a name that drifts onto the public surface fails loudly.
 */
const INTERNAL_PROPS =
  /^(parsed|plan|animations|keyframes|bands|transformPrefix|restore|displaced|lowestStart|highestEnd|unfinishable|pinBlocked|flatBlocked|cascadeBlocked|geometryDependent|runOnceRan|lastTransform|lastFilter|runOnce|positionUnit|slopes|scrollElementNode|transformValues|when|start|end)$/;

export default [
  defaultRollupConfig(pkg.filename, [], INTERNAL_PROPS),
  defaultRollupConfig(`${pkg.filename}-scroll-to`, [], undefined, { input: 'src/scroll-to.ts' }),
  defaultRollupConfig(`${pkg.filename}-easings`, [], undefined, { input: 'src/easings.ts' }),
  defaultRollupConfig(`${pkg.filename}-paint`, RUNTIME, undefined, { input: 'src/paint.ts', alwaysExternal: RUNTIME }),
  defaultRollupConfig(`${pkg.filename}-path`, RUNTIME, undefined, { input: 'src/path.ts', alwaysExternal: RUNTIME }),
  defaultRollupConfig(`${pkg.filename}-sequence`, RUNTIME, undefined, { input: 'src/sequence.ts', alwaysExternal: RUNTIME }),
  defaultRollupConfig(`${pkg.filename}-split`, RUNTIME, undefined, { input: 'src/split.ts', alwaysExternal: RUNTIME }),
  defaultRollupConfig(`${pkg.filename}-vera`, RUNTIME, undefined, { input: 'src/vera.ts', alwaysExternal: RUNTIME }),
];
