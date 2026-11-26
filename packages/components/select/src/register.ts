/**
 * Registration for `@vera-components/select`'s entry — the side effect that makes `import '@vera-components/select'` mean
 * "define every component". Lives here rather than in `index.ts` because an index only re-exports
 * (CODE-PRINCIPLES #1); the entry keeps its meaning through one side-effect import.
 */
import { VeraSelect } from './select/element.js';
import { diagnostic, SHARED } from '@verajs/shared-utils';


/**
 * A tag already defined by a *different* constructor means two copies or versions of this library
 * share the page — the second must not throw the app down, but silence would let the versions fork
 * invisibly, so it warns. Same class twice (the same module evaluated again) is a no-op.
 */
const define = (tag: string, constructor: CustomElementConstructor) => {
  const existing = customElements.get(tag);
  if (existing) {
    if (existing !== constructor && typeof console !== 'undefined')
      console.warn(diagnostic('select', `<${tag}>`, 'defined-twice', __DEV__ && SHARED.definedTwice('@vera-components/select', 'elements')));
    return;
  }
  customElements.define(tag, constructor);
};

/**
 * The literal repeats `selectSurface.tag` on purpose — importing the surface here would ship its
 * documentation in the runtime bundle. `tests/ui-surface.test.mjs` holds the two in lockstep.
 */
define('vera-select', VeraSelect);

declare global {
  /**
   * Types `document.createElement('vera-select')`, `querySelector` and a TSX `onChange` (`e.detail` from `'~events'`).
   * Under a stand-down (another copy already holds the tag) the type is still this copy's; the two can differ by a version.
   */
  // eslint-disable-next-line no-restricted-syntax -- HTMLElementTagNameMap is the DOM library's interface; only an interface merges into it
  interface HTMLElementTagNameMap {
    'vera-select': VeraSelect;
  }
}
