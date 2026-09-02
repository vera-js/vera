/**
 * `@verajs/ui` — importing this registers every component under its `vera-*` tag. For the classes
 * without registration, import `@verajs/ui/elements` instead.
 */
import { VeraSelect } from './select/element.js';

export * from './elements.js';

/**
 * A tag already defined by a *different* constructor means two copies or versions of this library
 * share the page — the second must not throw the app down, but silence would let the versions fork
 * invisibly, so it warns. Same class twice (the same module evaluated again) is a no-op.
 */
const define = (tag: string, constructor: CustomElementConstructor) => {
  const existing = customElements.get(tag);
  if (existing) {
    if (existing !== constructor && typeof console !== 'undefined')
      console.warn(
        `[vera] ui: <${tag}> is already defined by another copy or version of @verajs/ui — keeping the first. ` +
          `Align the versions, or import @verajs/ui/elements and register under your own names.`
      );
    return;
  }
  customElements.define(tag, constructor);
};

/**
 * The literal repeats `selectSurface.tag` on purpose — importing the surface here would ship its
 * documentation in the runtime bundle. `tests/ui-surface.test.mjs` holds the two in lockstep.
 */
define('vera-select', VeraSelect);
