/**
 * The base VALUE GRAMMAR, re-exported from `@verajs/shared-utils` since the motion package cut
 * (2026-09-10): motion's own parser speaks the same grammar and lives in `@verajs/motion`, which
 * must not depend on this engine — so the one implementation moved to the shared package both
 * inline at build. This shim keeps the engine's `./parse.js` imports true.
 */
export {
  parseValue,
  parseLiteral,
  isObject,
  isPath,
  sameValue,
  startsCustomProperty,
} from '@verajs/shared-utils';
export type { Parsed, ParsedObject, Path, ValueError } from '@verajs/shared-utils';
