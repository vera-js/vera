import { defaultRollupConfig } from '../../defaultRollupConfig.js';
import pkg from './package.json' with { type: 'json' };

/**
 * Two entries, one implementation:
 *
 * - `vera-ui` — imports the classes and **registers** the tags. The normal import.
 * - `vera-ui-elements` — the classes with **no side effects**, for consumers who must control
 *   registration themselves (two library versions on one page, scoped-registry experiments,
 *   defining under their own tag names). Costs nothing to ship and cannot be retrofitted once
 *   side-effect imports are documented usage.
 *
 * `@verajs/core` and `@verajs/hooks` stay external in every build, as `@verajs/store` keeps
 * core: the controllers' stores must live in the same core the app renders with — a bundled
 * private copy would hold state nothing else can see. The importmap resolves both on a CDN page.
 * @verajs/renderer/slots joins them: slotted() reads the wired module's HOSTS map, so a bundled
 * copy would read an empty one — the same shared-module rule.
 */
const external = ['@verajs/core', '@verajs/hooks', '@verajs/renderer/spread', '@verajs/renderer/keyed', '@verajs/renderer/slots'];

/**
 * Core's root and release-on-unmount set are `_$r$` and `_$c$`, sigiled, so no mangling regex can rename the reads (a
 * mangled `_root` here once made every root lookup fall back to the element, production build only);
 * `tests/core-structural-contracts.test.mjs` holds the names.
 */
const mangle = /^_[a-z]/;

export default [
  defaultRollupConfig(pkg.filename, external, mangle, { alwaysExternal: external }),
  defaultRollupConfig(`${pkg.filename}-elements`, external, mangle, {
    input: 'src/elements.ts',
    alwaysExternal: external,
  }),
];
