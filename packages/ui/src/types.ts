/**
 * The package's shared types — one `types.ts` at the import-graph root, per CODE-PRINCIPLES §1.
 */

/** A name-and-prose pair, which is the shape most of a surface's sections are. */
type Described = {
  readonly name: string;
  readonly description: string;
};

/**
 * The shape every component's surface declaration satisfies — `src/<component>/surface.ts`.
 *
 * A surface is the component's public API written as DATA, and three things are generated from or
 * checked against it: `custom-elements.json` (the ecosystem-standard manifest, diffed by the gate
 * so an API change without its manifest diff refuses), the docs page, and the runtime drift test
 * that renders the component and rejects a part or slot the declaration does not carry. Renaming
 * anything in a surface is a breaking change by definition; that is the point of writing it down.
 *
 * **Declare one with `as const satisfies ComponentSurface`, never with a type annotation.** The two
 * are not interchangeable here. An annotation widens every string to `string` and throws away the
 * literal vocabulary the manifest generator and the docs page read; `satisfies` checks the object
 * against this shape while leaving `tag` as `'vera-select'` and a part's name as `'menu'`. It is
 * also what catches a malformed surface — a mistyped `descriptoin` is a compile error naming the
 * intended key, where before it would have travelled silently into the manifest.
 *
 * This was `typeof selectSurface` until 2026-09-17, which read as a cross-component contract and
 * could not be one: `typeof` on an `as const` object is the type of THAT object, `tag: 'vera-select'`
 * literal included, so no second component could ever satisfy it. Nothing used it, so nothing had
 * noticed.
 */
export type ComponentSurface = {
  /** The registered tag name. */
  readonly tag: string;
  /** One paragraph: what the component is and the decisions a consumer makes about it. */
  readonly description: string;
  readonly attributes: readonly Described[];
  /** `type` is the public TypeScript spelling a consumer would write, not the internal one. */
  readonly properties: readonly (Described & { readonly type: string })[];
  /** `detail` describes the event's payload, or says plainly that there is none. */
  readonly events: readonly (Described & { readonly detail: string })[];
  readonly methods: readonly Described[];
  readonly slots: readonly Described[];
  readonly parts: readonly Described[];
  /**
   * Observable state reflected onto a part, for styling and for tests — `on` names the part,
   * `values` the complete vocabulary of that attribute.
   */
  readonly states: readonly {
    readonly on: string;
    readonly attribute: string;
    readonly values: readonly string[];
  }[];
  /** `ElementInternals` custom states, reachable from CSS as `:state(name)`. */
  readonly customStates: readonly Described[];
  /** Every CSS custom property the component reads. */
  readonly tokens: readonly string[];
};
