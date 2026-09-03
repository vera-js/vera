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
 * `@verajs/core` and `@verajs/hooks` stay external in every build, as `@verajs/reactivity` keeps
 * core: the controllers' stores must live in the same core the app renders with — a bundled
 * private copy would hold state nothing else can see. The importmap resolves both on a CDN page.
 * @verajs/renderer/slots joins them: slotted() reads the wired module's HOSTS map, so a bundled
 * copy would read an empty one — the same shared-module rule.
 */
const external = ['@verajs/core', '@verajs/hooks', '@verajs/renderer/spread', '@verajs/renderer/keyed', '@verajs/renderer/slots'];

/**
 * `_root` and `_cleanups` are exempt from mangling: it is core's structural contract for reaching a (possibly
 * closed) shadow root on the live element — the same exemption core's own regex carries, held by
 * `tests/core-structural-contracts.test.mjs`. Mangled, the element read `this.<mangled>` while
 * core stored `_root`, and every root lookup fell back to the element — production build only.
 */
const mangle = /^_(?!root$|cleanups$)[a-z]/;

export default [
  defaultRollupConfig(pkg.filename, external, mangle, { alwaysExternal: external }),
  defaultRollupConfig(`${pkg.filename}-elements`, external, mangle, {
    input: 'src/elements.ts',
    alwaysExternal: external,
  }),
];
