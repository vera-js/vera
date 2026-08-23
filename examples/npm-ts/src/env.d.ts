/**
 * Ambient declarations for this example's environment.
 *
 * Nothing here changes what the example does — it tells TypeScript about two things the example
 * legitimately relies on that `tsc` cannot know from the source alone. Added when the 2026-08-22
 * testing audit found the npm + TypeScript consumption mode carrying 24 type errors, none of which
 * were caught because CI did not type-check.
 */

/** Vite injects `import.meta.env`; the example switches the autoloader extension on `DEV`. */
interface ImportMetaEnv {
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly MODE: string;
}
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
