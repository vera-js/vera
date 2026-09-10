/**
 * The LEAN motion entry — `@verajs/directives/motion-core` — adoption condition 1.
 *
 * The compiler and the writer, nothing else: parse the object grammar, generate the CSS,
 * deliver it through the registry, drive the number, hand it to ticks — with NO engine, NO
 * directive layer, NO packs. This is the surface an embedder consumes to make vera-motion its
 * client implementation while keeping its own driver-of-the-number and its own delivery: the
 * timeline math, regions, gating and events stay the embedder's (or come from the full
 * `/motion` entry, which layers everything on top of exactly these modules).
 *
 * Everything here is engine-free BY CONSTRUCTION (the additive-bundle rule): the modules below
 * import nothing from `engine.ts`, and the one upward import in the whole graph is the base
 * value grammar. The published size of THIS bundle is the number the adoption calculus runs on.
 */

/** The grammar: one attribute value in, a validated ParsedElement out. */
export { parseMotion, serializeMotion, staggerHost, MOTION_ATTR } from './parse.js';

/** The compiler: a ParsedElement becomes CSS — groups, segments, tiers, transition mode. */
export { generateSimple, mergeBandsForWidth, fromAttribute } from './generate.js';

/** Delivery: content-hashed rules into whichever tree needs them, tails pinned last. */
export {
  acquire, release, contentHash, ensureProperty, setTails,
  PROGRESS_PROPERTY, STAGGER_PROPERTY, SCROLL_PROPERTY,
  RANGE_START_PROPERTY, RANGE_SIZE_PROPERTY,
} from './registry.js';

/** The number's writer: chase, ramp, idle write-through — one self-stopping loop. */
export { syncTo, rampTo, dispose } from './drive.js';


/** The named-JS door. */
export { wireFunctions, functionFor } from './functions.js';

/** The server half lives in its OWN subpath (`/motion-ssr`): an embedder's CLIENT bundle never
 *  ships the emitter, and a server never minds the extra import. */

export type { ParsedElement, ElementMotion, ParseContext, Generated, GeneratedGroup, GeometryContext, Driven, SheetRoot, MotionFunction, MotionFunctionModule } from './types.js';
