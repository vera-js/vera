/**
 * Ambient declarations for this example's environment.
 *
 * Nothing here changes what the example does — it tells TypeScript about two things the example
 * legitimately relies on that `tsc` cannot know from the source alone. Added when the 2026-08-22
 * testing audit found the npm + TypeScript consumption mode carrying 24 type errors, none of which
 * were caught because CI did not type-check.
 */

/**
 * Vite injects `import.meta.env`; the example switches the autoloader extension on `DEV`.
 *
 * **Interfaces are mandatory here, not a lapse from §1.3's `type` rule.** `ImportMeta` is declared
 * by TypeScript's own standard library, and the only way to add `env` to it is DECLARATION MERGING —
 * the exact capability the rule exists to keep out of published types, and the exact capability an
 * ambient environment file is for. Spelling either one `type` is a `Duplicate identifier` error, so
 * the rule is disabled rather than satisfied. `ImportMetaEnv` goes with it: it is the merged
 * member's type and Vite's own convention is that a consumer merges further members into it.
 */
// eslint-disable-next-line no-restricted-syntax -- merging into the stdlib's ImportMeta is the point
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}
// eslint-disable-next-line no-restricted-syntax -- ditto: this augments a lib.es2020 declaration
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/**
 * A URL import, which is exactly what the buildless story is for — the browser resolves it, and
 * Vite leaves it alone. TypeScript has no way to fetch and type it, so it is declared here rather
 * than suppressed at each call site.
 */
declare module 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/shoelace-autoloader.js' {
  /** Callers pass `this.shadowRoot`, which is `ShadowRoot | null` on a plain HTMLElement. */
  export function discover(root: Element | ShadowRoot | Document | null): Promise<void>;
}
