/**
 * `@verajs/motion/easings` — non-linear curve shaping.
 *
 * Wire this if any element sets `ease` to something other than `linear`.
 * Without it the runtime still runs, every curve is a straight line, and it
 * says so once in the console rather than animating quietly wrong.
 *
 * It is a separate import because `linear` is the default and most pages never
 * leave it: the bezier solver and the step function were 384 bytes every page
 * paid for a feature it was not using.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { easings } from '@verajs/motion/easings';
 *
 * wireMotion(easings);
 * ```
 *
 * Take `wireMotion` from `@verajs/motion` — this module exports a descriptor and
 * never registers itself.
 */
import { resolveEasing } from './modules/easings.js';
import type { Insert } from './modules/schema.js';

export { resolveEasing } from './modules/easings.js';

/** Hand this to `wireMotion`. */
export const easings: Insert = { on: 'easing', fn: resolveEasing };
