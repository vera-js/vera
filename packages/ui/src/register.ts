/**
 * Registration for `@verajs/ui`'s entry — the side effect that makes `import '@verajs/ui'` mean
 * "define every component". Lives here rather than in `index.ts` because an index only re-exports
 * (CODE-PRINCIPLES #1); the entry keeps its meaning through one side-effect import.
 */
import { VeraSelect } from './select/element.js';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';


/**
 * A tag already defined by a *different* constructor means two copies or versions of this library
 * share the page — the second must not throw the app down, but silence would let the versions fork
 * invisibly, so it warns. Same class twice (the same module evaluated again) is a no-op.
 */
const define = (tag: string, constructor: CustomElementConstructor) => {
  const existing = customElements.get(tag);
  if (existing) {
    if (existing !== constructor && typeof console !== 'undefined')
      console.warn(diagnostic('ui', `<${tag}>`, 'ui-defined-twice', __DEV__ && PROSE['ui-defined-twice'](tag)));
    return;
  }
  customElements.define(tag, constructor);
};

/**
 * The literal repeats `selectSurface.tag` on purpose — importing the surface here would ship its
 * documentation in the runtime bundle. `tests/ui-surface.test.mjs` holds the two in lockstep.
 */
define('vera-select', VeraSelect);
