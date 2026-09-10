/**
 * The FIRST-PARTY EMBEDDER surface — what `@verajs/directives`' motion pack imports to wire this
 * engine into its registry. Deliberately separate from `./core` (the public embedder contract,
 * omni's vendored line): this entry exposes activation glue whose shape follows the pack's needs
 * and carries no stability promise beyond the two first parties. A third-party embedder belongs
 * on `./core`; a name needed here and there is exported from both on purpose.
 */
export { parseMotion, forgetStagger, staggerHost, serializeMotion, MOTION_ATTR } from './parse.js';
export {
  createRegion, enableMotion, disableMotion, configurePreferences, runInserts,
} from './group.js';
export type { RegionOptions } from './group.js';
export {
  registerVocabulary, setProblemReporter, parseEasing, parseSelector, parseOrigin,
  properties, settings, parseMeasure, pageProblem,
} from './schema.js';
export { paintRows } from './paint.js';
export { pathRows, parsePathData } from './path.js';
export { sequenceRows, sequenceModule } from './sequence.js';
export type { SequenceOptions } from './sequence.js';
export { wireFunctions, functionFor } from './functions.js';
export { lookUpPreset, lookUpMerged, PRESETS } from './presets.js';
export { renderMotion } from './ssr.js';
export { EVENTS } from './events.js';
export * as keyframeRegistry from './registry.js';
export * as writePath from './generate.js';
export * from './types.js';
