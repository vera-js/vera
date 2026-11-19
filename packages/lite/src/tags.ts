/**
 * **`@verajs/lite`'s template tags, `html`, `svg` and `mathml`**: the same tags as `@verajs/core`'s
 * (`packages/core/src/store/store.ts`), a second copy on purpose (2026-11-18). When both packages took the tags from one
 * shared-utils module, they moved within core's production bundle, and core's create1k measured +3.5% slower in Chrome
 * (20 sessions, A/A valid); with its own copy, core's bundle is byte-identical to the one raced at release.
 * `tests/lite.test.mjs` holds the two copies to one shape — never fold them back into one. Each tag is written out, as
 * core's are (one function per kind: no tag built by a factory, so each stays a plain function the engine inlines).
 *
 * Called with a string instead of tagged, development names it, in core's words (`tag-called`): `html('<p>x</p>')` puts a
 * string where the strings array goes and fails much later, naming nothing. Production folds the check away.
 */
import { misuse, SHARED } from '@verajs/shared-utils';
import type { ResultType, TemplateResult } from './types.js';

const tagCalled = (type: ResultType, strings: unknown): void => {
  if (!Array.isArray(strings)) {
    const name = ['html', 'svg', 'mathml'][type - 1]!;
    throw new TypeError(misuse(name, 'tag-called', __DEV__ && SHARED.tagCalled(name, typeof strings === 'string' ? JSON.stringify(strings) : String(strings), '<p>hi</p>')));
  }
};

/** The `html` tagged template. */
export const html = (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<1> => {
  if (__DEV__) tagCalled(1, strings);
  return { ['_$litType$']: 1, strings, values };
};
/** The `svg` tagged template — markup parsed as SVG, for a fragment that is not inside an `<svg>` element. */
export const svg = (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<2> => {
  if (__DEV__) tagCalled(2, strings);
  return { ['_$litType$']: 2, strings, values };
};
/** The `mathml` tagged template — markup parsed as MathML, for a fragment that is not inside a `<math>` element. */
export const mathml = (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<3> => {
  if (__DEV__) tagCalled(3, strings);
  return { ['_$litType$']: 3, strings, values };
};
