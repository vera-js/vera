/**
 * The front door: EVERYTHING, WIRED: NOTHING (design §16b). The root re-exports the whole
 * package — engine, interaction pack, expression tier — and activates none of it; importing is
 * never activating, `wireDirectives` is where choice happens. npm granularity is tree-shaking
 * (`sideEffects: false`; the packs are side-effect-free data, so naming only what you use is
 * what you pay for) — verified by the gate's shaking test, because tree-shakeability is a claim
 * like a size claim. CDN granularity is the per-concern dist files, addressed by path.
 */
export { wireDirectives, activate, deactivate, settled, rejections, describeDirectives, stateOf, directives, renderDirectives, takeDirectiveNames } from './engine.js';
export { interaction } from './interaction.js';
export { expressions, compileExpression } from './expressions.js';
export { motion, easings, paint, path, sequence, split, enableMotion, disableMotion } from './motion/index.js';
export type { MotionOptions } from './motion/index.js';
export { parseValue } from './parse.js';
export type { Directive, Ctx, Rejection, Teardown, Cleanup } from './types.js';
export type { Parsed, ParsedObject, Path } from './parse.js';
