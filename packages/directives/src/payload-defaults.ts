/**
 * The `$` vocabulary the engine ships — the DECLARATION, apart from the engine that registers it.
 *
 * Its own module for the same reason `docs-url.ts` and `scripts/size-modules.mjs` are: something
 * other than the runtime needs to read it. `scripts/sync-diagnostics.mjs` publishes this list into
 * `diagnostics.json` and into the documentation, and a hand-typed second copy of a vocabulary is a
 * copy that drifts — which is how `$x $y $button` came to be written in three places with nothing
 * checking any of them against the code.
 *
 * Getters return PRIMITIVES (design §20.1): deterministic, serializable, and safe to log, diff, or
 * hand to an agent. The engine enforces that in development.
 */
export type Payload = Record<string, (event: Event) => string | number | boolean | null>;

/** Every event answers `$type`, whatever else it offers — one getter, not one per base. */
export const TYPE: Payload = { type: (event) => event.type };

/**
 * Pointer geometry as the PAGE sees it — `clientX/Y` rather than screen or offset, because a
 * handler writing coordinates into state is positioning something in the page.
 */
const POINTER: Payload = {
  x: (event) => (event as MouseEvent).clientX ?? 0,
  y: (event) => (event as MouseEvent).clientY ?? 0,
  button: (event) => (event as MouseEvent).button ?? 0,
};

const KEYS: Payload = { key: (event) => (event as KeyboardEvent).key ?? '' };

/**
 * `$value` and `$checked` come from the TARGET, not the event — that is where a form control keeps
 * them, and it is what makes `{ q: $value }` mean what an author expects both on the element they
 * wrote it on and on one it bubbled from.
 */
const CONTROL: Payload = {
  value: (event) => (event.target as HTMLInputElement | null)?.value ?? '',
  checked: (event) => (event.target as HTMLInputElement | null)?.checked ?? false,
};

const spread = (bases: readonly string[], payload: Payload): Record<string, Payload> =>
  Object.fromEntries(bases.map((base) => [base, payload]));

export const DEFAULT_PAYLOADS: Record<string, Payload> = {
  ...spread(['click', 'dblclick', 'mousedown', 'mouseup', 'mousemove', 'contextmenu',
    'pointerdown', 'pointerup', 'pointermove'], POINTER),
  ...spread(['keydown', 'keyup', 'keypress'], KEYS),
  ...spread(['input', 'change'], CONTROL),
};
