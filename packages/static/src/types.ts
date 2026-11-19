/**
 * **`@verajs/static`'s types** — its own (`define`'s options and class), and the ones it speaks with `@verajs/core` and
 * `@verajs/lite` (shared-types', re-exported, so a component's types read the same in all three).
 */
export type { Methods, ResultType, TemplateResult, WithAttributes } from '@verajs/shared-types';

/**
 * **A `@verajs/static` component**: the root it rendered into, under core's sigil for the same meaning (`_$r$`, its
 * shadow root or itself). Set once, at the first connect; a component moved later keeps its markup and is not rendered
 * again. Sigiled, not `_`-named, for lite's reason: it sits on an author's element, and the production mangler renames
 * `/^_(?!p$)[a-z]/` names to ones that could collide with the author's own fields.
 */
export interface StaticElement extends HTMLElement {
  _$r$?: ShadowRoot | HTMLElement;
}
/** `define`'s options: `@verajs/core`'s, less what only core does (`foreignNodes`, `persist`, a `ShadowRootInit`). */
export type DefineOptions = { tag: string; shadow?: 'open' | 'closed' | false };
/** The class `define` returns: its instances carry the props, attributes and methods. */
export type DefinedClass<M> = { new (): HTMLElement & M; prototype: HTMLElement & M };
