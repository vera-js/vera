/**
 * **`@verajs/lite`'s types** — its own (the element's fields, `define`'s options and class), and the ones it speaks with
 * `@verajs/core` (shared-types', re-exported, so a component's types read the same in both).
 */
export type { Methods, ResultType, Signal, TemplateResult, WithAttributes } from '@verajs/shared-types';

/**
 * **A `@verajs/lite` component**: what its `define` keeps on the element, SIGILED as core's own
 * fields are, reusing core's sigil where the meaning is the same. **Who reads them:** only this package's own modules
 * (`define`, `schedule`, `signal`, `patch`), and its tests (`_$l$`); no other package. **Why sigiled, not `_`-named:**
 * they sit on an AUTHOR's element, and the production mangler renames `/^_(?!p$)[a-z]/` to one- or two-letter names that
 * could collide with the author's own fields; a `_$…$` name never matches, so it survives every build unchanged.
 */
export interface LiteElement extends HTMLElement {
  /** The declared props' values, built from the defaults at the first touch: `@verajs/core`'s `_$v$`, the same record. */
  _$v$?: Record<string, unknown>;
  /** The root it renders into: its shadow root, or itself (core's `_$r$`). */
  _$r$?: LiteRoot;
  /** Its render function: `undefined` until set up (and again once retired), `null` when the setup returned none. */
  _$f$?: (() => unknown) | null;
  /** A render is queued for the next microtask. */
  _$u$?: boolean;
  /** The readers of every signal it read: it leaves each when it is retired. */
  _$l$?: Set<Set<LiteElement>>;
}
/**
 * What the lite renderer keeps on the root it paints (`patch.ts`, its only reader): the root range, made on the first
 * paint. Sigiled for the reason `LiteElement` gives: the root may be the author's own element.
 */
type RootRange = {
  /** The root range's part: it commits the render's result into the whole root. */
  _$t$?: (values: readonly unknown[], at: number) => void;
};
/** A small-tier component's shadow root, as the lite renderer paints it. */
interface LiteShadowRoot extends ShadowRoot, RootRange {}
/** A small-tier component rendering into itself (no shadow root), as the lite renderer paints it. */
interface LiteHostRoot extends HTMLElement, RootRange {}
/** Where a small-tier component renders: its shadow root or the element itself. */
export type LiteRoot = LiteShadowRoot | LiteHostRoot;
/** `define`'s options: `@verajs/core`'s, less what only core does (`foreignNodes`, `persist`, a `ShadowRootInit`). */
export type DefineOptions = { tag: string; shadow?: 'open' | 'closed' | false };
/** The class `define` returns: its instances carry the props, attributes and methods. */
export type DefinedClass<M> = { new (): HTMLElement & M; prototype: HTMLElement & M };
