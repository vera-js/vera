/**
 * The demo's gradient-morph module — deliberately written the way a page
 * author would write one, because that is what it demonstrates: the runtime
 * animates *numbers*, and which numbers is an author's decision.
 *
 * Three custom properties — hue, centre x, centre y — that one CSS
 * declaration composes into a radial gradient (`styles.css` registers them
 * with `@property`, so the inertia transition interpolates them exactly as it
 * does a transform). The counterpart to `paint`: paint holds values the
 * runtime cannot put on a number line and lets the engine blend each step;
 * this puts the *parameters* of a value on the number line, so the morph
 * itself is continuous.
 *
 * Demo-owned, like `demo.ts` — not a library entry and never built. Its own
 * file rather than inline in the bootstrap so `scripts/check-examples.js` can
 * wire it when validating the demo's markup, per that script's rule that a
 * page's vocabulary is the page plus the modules it loads.
 */
import type { PropertyDef } from './modules/schema.js';

/**
 * What a panel would tell an author to import. A demo module, so it names its
 * own file rather than a package subpath. See `PropertyDef.from`.
 */
const FROM = './demo-gradient.js';

export const gradient: readonly PropertyDef[] = [
  { attribute: 'gradient-hue', from: FROM, category: 'gradient', cssProperty: '--gradient-h', defaultUnit: '', units: [''], initial: 155 },
  { attribute: 'gradient-x', from: FROM, category: 'gradient', cssProperty: '--gradient-x', defaultUnit: '%', units: ['%'], initial: 25 },
  { attribute: 'gradient-y', from: FROM, category: 'gradient', cssProperty: '--gradient-y', defaultUnit: '%', units: ['%'], initial: 30 },
];
