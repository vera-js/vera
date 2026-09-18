/**
 * The shared value grammar's types — one `types.ts` at the import-graph root, per
 * CODE-PRINCIPLES §1.
 *
 * `@verajs/shared-utils` is never published; both `@verajs/directives` and `@verajs/motion` inline
 * it, which is exactly why these shapes need one home. Two packages that agree about a grammar by
 * each keeping a copy of its types agree only until one of them is edited.
 */

/**
 * A parse failure, as the SHAPE it is rather than a class — an ordinary `Error` with `code` and
 * `at` assigned onto it (the same refusal shape `@verajs/autoloader` uses). No subclass, so
 * nothing has to survive bundling or cross a realm boundary intact: a caller tests `error.code`,
 * never `instanceof`.
 *
 * `code` is the stable name a caller converts into its own diagnostic — the directives engine
 * turns it straight into a rejection — and `at` is the index into the SOURCE STRING, not a line
 * or column, because the source is one attribute's value.
 */
export interface ValueError extends Error {
  code: string;
  at: number;
}

/**
 * A REFERENCE the author wrote, parsed and not yet resolved — `open`, `user.name`, `@count`,
 * `!draft`. The parser deliberately stops here: what a path reads depends on the element it is
 * evaluated for, so resolution belongs to the consumer (`ctx.eval`), and the same parsed value is
 * cached and reused across every element that shares the attribute text.
 *
 * `global` is the `@` prefix — the page store rather than the nearest carrier. `negate` counts the
 * `!`s and is already reduced to a boolean, so `!!open` arrives as `negate: false` rather than as
 * something a consumer has to unwind. `segments` is the dotted name pre-split, never empty.
 *
 * `true`, `false` and `null` are the one overlap and they are resolved HERE: a bare keyword parses
 * to the literal, but `@true` or `!true` is a path, because a prefix means the author is naming
 * something.
 */
export type Path = { kind: 'path'; negate: boolean; global: boolean; segments: string[] };

/**
 * Anything `parseValue` can produce — the grammar's whole output vocabulary, recursive through
 * objects and arrays.
 *
 * **A `string` here is a QUOTED literal, always.** A bare word parses to a `Path`, so the union's
 * `string` member can never be an unresolved name that a consumer has to decide about; that is the
 * property that lets a directive treat a string as text with no further checking.
 *
 * Distinguishing the two object-ish members needs the helpers, not `typeof`: use `isPath` and
 * `isObject`, which test for the ABSENCE of a `kind` rather than for a known list of kinds —
 * spelling it as a list is what let the expressions tier's `{ kind: 'expr' }` node pass as data.
 */
export type Parsed = string | number | boolean | null | Path | ParsedObject | Parsed[];

/**
 * A braced object the author wrote — `{ url: '/cart', method: 'GET' }` — with its values STILL
 * PARSED one level down, which is the entire point: each entry may be a path, so a consumer
 * evaluates entries against context at the moment it uses them instead of receiving strings.
 *
 * **The prototype is null.** The grammar guarantees no getters and no cycles, so `Object.create(null)`
 * costs nothing and closes the inherited-name hole by construction: `__proto__`, `constructor` and
 * `toString` are ordinary keys here, and a consumer walking one cannot reach anything an author did
 * not write. Duplicate keys are a parse failure rather than a last-one-wins silent overwrite.
 */
export type ParsedObject = { [key: string]: Parsed };
