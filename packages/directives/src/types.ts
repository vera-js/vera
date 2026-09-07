/**
 * The directive contract — DESIGN-DIRECTIVES §2, as refined by §19.1. These words face every
 * directive author; keep them exactly as the design doc records them.
 */
import type { ParsedObject } from './parse.js';

export type Teardown = () => void;
export type Cleanup = () => void;

export type Ctx = {
  /** Read a context key (nearest OWNER; `@key` reads the page store). Dotted tails walk own props. */
  get: (key: string) => unknown;
  /** Write a context key (owner, else nearest carrier; `@key` writes the page store). */
  set: (key: string, value: unknown) => void;
  /** Run a parsed assignments object — every write goes through the store. */
  run: (assignments: ParsedObject) => void;
  /**
   * Re-read a `data-vd-*` attribute on this element NOW and run it as an assignments object —
   * the dispatch-time primitive for event directives (delegation reads fresh text at fire time,
   * so swapped-in markup behaves from its first event). Unparseable or non-object values become
   * rejections, never throws.
   */
  runAttr: (attr: string) => void;
  /** Evaluate one parsed value against this element's context (paths resolve, literals pass). */
  eval: (value: unknown) => unknown;
  /** The family match result, when this directive was claimed through a `{ match }` name. */
  selection: unknown;
  /** Record a refusal in the rejections registry (dev prints once per code×directive). */
  reject: (code: string, message: string, fix?: string) => void;
};

export type Directive = {
  /** The suffix after `data-vd-`, or a family matcher returning parsed selection args or null. */
  name: string | { match: (suffix: string) => unknown | null };
  /** How the engine parses the attribute text BEFORE the directive sees it. */
  value: 'literal' | 'expression' | 'object' | 'none';
  /**
   * Once per element×directive: wiring that is not value-dependent. May return a teardown, or
   * `{ apply, teardown }` — an apply returned here closes over setup's locals, so per-instance
   * state is ordinary closure variables.
   */
  setup?: (el: Element, ctx: Ctx) => void | Teardown | { apply?: Directive['apply']; teardown?: Teardown };
  /**
   * The reactive half. Runs INSIDE AN ENGINE-OWNED HOOK: reading context state subscribes, a
   * write re-runs it on core's scheduler, and a returned function is the per-run cleanup.
   */
  apply?: (el: Element, value: unknown, ctx: Ctx) => void | Cleanup;
  /** Order among directives on ONE element. Lower first: state=10, reflections=50, events=70. */
  priority?: number;
  /** Introspectable documentation — REQUIRED on shipped packs; feeds describeDirectives(). */
  docs?: { summary: string; example: string };
  /**
   * What this directive does during a SERVER render (design §9), where there is markup and state
   * but no events, no timers and no client.
   *
   * Absent — the safe default — means BEHAVIORAL: nothing to say before an event exists. That is
   * not a limitation for handlers, which need no server pass at all: the handler lives in the
   * attribute and delegation matches it at dispatch, so a server-rendered page is interactive the
   * moment the engine boots, with no per-element hydration.
   *
   * `true` means DECLARATIVE and server-safe: the engine resolves this directive's apply exactly
   * as it does in a browser (a plain `apply`, or the one a `setup` returns) and calls it ONCE, so
   * the reflection is already correct in the HTML and the client's first pass re-derives the same
   * answer. Declaring it asserts that `setup` touches nothing a server cannot own — no listeners,
   * no observers, no timers.
   *
   * A FUNCTION is the escape hatch for a directive whose client path is not server-safe but which
   * still has a server truth to write: it receives the evaluated value and writes the markup.
   */
  ssr?: boolean | ((el: Element, value: unknown, ctx: Ctx) => void);
};

export type Rejection = {
  element: Element | null;
  directive: string;
  code: string;
  message: string;
  fix?: string;
};
