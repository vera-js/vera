/**
 * **The renderer's binding kinds and child-part modes** — numbers both `renderer.ts` and the separately bundled
 * `hydration.ts` read, from ONE source (each bundle inlines them; they are literals in the output). A change here
 * changes the hand-off's protocol: bump `$V` in `renderer.ts`.
 */
/** A binding's kind, resolved once per template. */
export const IGNORED = 0; // consumed, nothing rendered: inside a comment, the later values of a multi-part attribute
export const CHILD = 1; // anchored on a primed empty text node the template carries
export const SOLE = 2; // its element's only content: no anchor in the template, the first commit writes `textContent`
export const ATTR = 3;
export const PROPERTY = 4;
export const BOOLEAN = 5;
/** `EVENT` through `ADOPT` hold a `Slot` record in their node slot — one range test, in `instantiate` and `commit`. */
export const EVENT = 6;
/** An element-position expression: a ref, or a value that applies itself (`_$apply$`). */
export const REF = 7;
/** An element-position expression ON a `<select>`: a value applying itself there (a spread) waits for `flush`. */
export const SELECT_REF = 8;
/** `.name` on a custom element — see `adoptProperty` in shared-utils. */
export const ADOPT = 9;
/**
 * Kinds from here on re-assert on EVERY render, so the update loop never skips them as unchanged:
 * `!name` writes from the live DOM's point of view (a sibling radio's click unchecks this one with no
 * event on it), and a `<select>`'s selection is re-applied after its options exist — see `flush`.
 */
export const LIVE = 10;
/** A `<select>`'s selection — `value` or `selectedIndex` (`isSelection`) — written when the pass ends: see `flush`. */
export const SELECT = 11;
/** `!name` on a custom element: compared against the LIVE value — read through `untracked`, it is the component's getter. */
export const LIVE_CUSTOM = 12;
/** A binding that must never write — and, from here on, the kinds `commit` handles before anything is computed. */
export const REFUSED = 13;
/** A `<select>`'s `selectedIndex` — the rare spelling of its selection, queued as `SELECT` is (see `flush`). */
export const SELECT_INDEX = 14;


/** A child part's mode: what its range currently holds. */
export const EMPTY = 0;
export const TEXT = 1;
export const TEMPLATE = 2;
export const LIST = 3;
export const NODE = 4;

/**
 * **The hydration hand-off's positions** — the renderer sets `$H` to an array at `connect`, and `hydration.ts` reads
 * it by these. An array, not an object of named fields: the names cost every app bytes (−35 B gzipped measured,
 * 2026-10-02), and these constants inline to literals in both bundles. The first two are FROZEN across protocols — a
 * hydration from another release reads the protocol at 0 and, on a mismatch, can still install its clearing hook at 1.
 * Any other change here is a protocol change: bump the renderer's protocol number.
 */
/** The protocol number — FROZEN at 0. */
export const HANDOFF_PROTOCOL = 0;
/** The first-render hook's setter — FROZEN at 1. */
export const HANDOFF_ADOPTER = 1;
export const HANDOFF_GET_TEMPLATE = 2;
export const HANDOFF_CHILD_PART = 3;
export const HANDOFF_INSTANCE = 4;
export const HANDOFF_SLOT = 5;
export const HANDOFF_UNSET = 6;
export const HANDOFF_UPGRADED = 7;
export const HANDOFF_COMMIT = 8;
export const HANDOFF_COMMIT_AS = 9;
export const HANDOFF_HOOK_UP = 10;
export const HANDOFF_RESOLVE = 11;
export const HANDOFF_ROOTS = 12;
export const HANDOFF_TO_TEXT = 13;
export const HANDOFF_REMOVAL_WORK = 14;
