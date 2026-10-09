/**
 * **`@verajs/renderer/spread`'s own diagnostics — DEVELOPMENT ONLY.** A spread key refused for the same reason a template
 * binding is (`__proto__`, a bound `srcdoc`, an inline handler) raises the shared code from shared-utils' table; these
 * are the refusals only a spread can meet — its names arrive at runtime.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'spread-unsafe-name': (key) => [
    `refusing ${key} — an attribute name cannot contain whitespace, a quote, \`<\`, \`>\`, \`/\`, \`=\` or a control character, and one that cannot be written into markup would not survive server rendering.`,
    'Spread names arrive at runtime; check where this key came from.',
  ],
  'spread-inner-html': (key) => [
    `refusing ${key} — spread names arrive at runtime, which is exactly the property that makes an HTML sink unreviewable.`,
    'Write it in the template — html`<div .innerHTML=${trusted}>` — sanitized first (renderer README, security note).',
  ],
  'spread-not-object': (received) => [
    `ignoring a props bag that is not a plain object — received ${received}. A string is iterated by character index, so \`spread('text')\` would set attributes named 0, 1, 2 and 3; anything else applies nothing at all.`,
    'This is usually an import or a property that resolved to something unexpected.',
  ],
};
