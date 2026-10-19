import { misuse, SHARED } from '@verajs/shared-utils';
import type { ComponentElement, ResultType, HookRecord, Cell, TemplateResult } from '../types.js';

/** The element between `init()` and the `render()` that commits it — hooks register against it. */
export const currentInstance: { element: ComponentElement | null } = { element: null };

/**
 * The hooks currently running, innermost last. A store read records whatever is on top as a
 * dependency. A stack rather than one slot because a hook can run inside another — a nested
 * component rendering in the middle of its parent's template.
 */
/**
 * **The components THIS copy of core initialized** — what its `customElements.define` wrapper may tear down: a field
 * under a `Symbol` private to this copy of core (a page can load two copies — a bundle inlining it — and each must know
 * only its own). It was a WeakSet keyed by the element; a weak collection keyed by DOM nodes costs both engines'
 * collectors per entry (the renderer's root parts measured ~10%, 2026-10-17).
 */
export const MINE = Symbol();
export type Mine = { [MINE]?: true };

/**
 * **The hook reading right now — ONE cell, not a stack** (work queue 6, A14a, 2026-10-16). Every tracked store read asks
 * it who to subscribe (`track`). Each place that starts a run — a hook's run (`$t`), `untracked`, `init`'s setup window —
 * saves the cell, sets it, and restores it in its `finally`, so nesting (a `computed` read inside a render) lives on the
 * call stack and a throw restores the outer reader. The one "current subscriber" signals-readiness asks for. An exported
 * CONST object with a mutable field — never an exported `let`, which would be a live binding on the read path.
 */
export const tracking: { hook: HookRecord | undefined } = { hook: undefined };

/**
 * Every subscription: target object → key → that key's CELL (the hooks that read it). PROTOTYPE (probe/cells,
 * 2026-10-18): a cell holds its hooks STRONGLY and retirement unlinks them exactly (it held one `WeakRef` per hook).
 *
 * A key is anything a store module tracks — a property, or a collection's entry key, an object
 * included. A weak collection's container is really a `WeakMap` (see `track`); it is declared as a
 * `Map` because only `get` and `set` are ever called on it, which the two share, and a union would
 * make every read narrow for a difference that does not exist at these call sites.
 */
export const proxyCallbacks = new WeakMap<object, Map<unknown, Cell>>();

/**
 * **Unlinks `hook` from its sources `s[from..]`, each in O(1) amortized** (ORDER VARIANT): each link becomes a TOMBSTONE in its
 * cell, so the remaining readers keep subscription order; a cell compacts in one stable pass once tombstones pass half
 * its slots, and only that bumps its `m` (a wake in progress restarts then). Used where a re-run's reads DIVERGE from its last run's (`track`), for the reads a re-run no longer reached
 * (`$t`), and with `from = 0` for retirement: links are strong, so this is what releases them.
 */
export const unlinkFrom = (hook: HookRecord, from: number) => {
  const s = hook.s;
  const x = hook.x;
  while (s.length > from) {
    const cell = s.pop()!;
    const pos = x.pop()!;
    /** A tombstone, in place: no reader moves, so the order of the rest is kept. */
    clearAt(cell, pos);
    if (++cell.d * 2 > cell.n) compactCell(cell);
  }
};

/** One stable pass: live readers move down in order, each told its new position; tombstones go. */
const compactCell = (cell: Cell) => {
  const n = cell.n;
  let w = 0;
  for (let p = 0; p < n; p++) {
    const hook = readerAt(cell, p);
    if (hook === undefined) continue;
    const slot = slotAt(cell, p);
    if (w !== p) {
      placeAt(cell, w, hook, slot);
      hook.x[slot] = w;
    }
    w++;
  }
  if (w === 0) cell.a = undefined;
  if (cell.h !== undefined) {
    const keep = w > 0 ? w - 1 : 0;
    cell.h.length = keep;
    cell.j!.length = keep;
  }
  cell.n = w;
  cell.d = 0;
  cell.m = (cell.m + 1) % 0x3fffffff;
};

/**
 * **The cell's positions, in ONE place** (readability, Brian 2026-10-19). Position 0 is the inline first reader (`a`,
 * its slot `ja`); position k ≥ 1 is `h[k − 1]` / `j[k − 1]` (the arrays exist only from a second reader). Every other
 * line of the engine sees an ordered list through these four. They are only ever handed a `Cell`, which has ONE shape
 * (every field assigned at creation): keep it that way, or these shared hot helpers go megamorphic (BROWSER-LEDGER).
 */
export const readerAt = (cell: Cell, p: number) => (p === 0 ? cell.a : cell.h![p - 1]);
export const slotAt = (cell: Cell, p: number) => (p === 0 ? cell.ja : cell.j![p - 1]!);
/** A reader and its slot placed at position `p`. */
export const placeAt = (cell: Cell, p: number, hook: HookRecord, slot: number) => {
  if (p === 0) {
    cell.a = hook;
    cell.ja = slot;
  } else {
    cell.h![p - 1] = hook;
    cell.j![p - 1] = slot;
  }
};
/** Position `p`'s recorded slot rewritten (`claim`). */
const reslotAt = (cell: Cell, p: number, slot: number) => {
  if (p === 0) cell.ja = slot;
  else cell.j![p - 1] = slot;
};
/** Position `p` emptied: a tombstone. */
const clearAt = (cell: Cell, p: number) => {
  if (p === 0) cell.a = undefined;
  else cell.h![p - 1] = undefined;
};
/** A second or later reader: the arrays, created on the first need (`track` links the first inline). */
export const grow = (cell: Cell, hook: HookRecord, slot: number) => {
  if (cell.h === undefined) {
    cell.h = [hook];
    cell.j = [slot];
  } else {
    cell.h.push(hook);
    cell.j!.push(slot);
  }
};

/**
 * **A re-run CLAIMS a link it made last run, further along its sources** (PROTOTYPE, probe/cells, 2026-10-19): `track`
 * found that the key's last link is this hook's, beyond the cursor `i`, so the read is one it made last run in a
 * different place (a reorder: rows 1 and 998 swapped). The link is SWAPPED to the cursor, and both moved links' cells
 * are told their new places, so nothing is unlinked and relinked: a plain `.map` swap re-matched about 3 000 reads by
 * unlinking and relinking everything after the first swapped row (Firefox swap +9% vs landed, race3). Out of line,
 * so `track` stays inside the inlining budget. BOTH moved links' cells are rewritten (each cell records where its
 * reader's link sits in `s`): missing one would make a later unlink remove the wrong link, a silent lost subscription.
 *
 * **For a LIST hook (design B), a swap must never cross a row's segment** (vera-5a): there a link's position IS its row,
 * so moving one outside the open segment `[lo, h)` would hand it to another row (stale). B's `track` claims only when
 * `at < h` and relinks otherwise; an ordinary hook's segment is all of `s`.
 */
export const claim = (hook: HookRecord, cell: Cell, at: number, i: number) => {
  const s = hook.s;
  const x = hook.x;
  const other = s[i]!;
  const otherAt = x[i]!;
  const mine = x[at]!;
  s[i] = cell;
  x[i] = mine;
  s[at] = other;
  x[at] = otherAt;
  reslotAt(cell, mine, i);
  reslotAt(other, otherAt, at);
};

/**
 * One tag per template kind: the strings and values, marked with the kind for a renderer to consume.
 *
 * **Called with a string instead of tagged, development names it** (main had this; the lean rebuild dropped it):
 * `html('<p>x</p>')` puts a string where the strings array goes, passes every shape check, and fails much later inside
 * the renderer with "Invalid value used as weak map key", naming nothing. `Array.isArray`, not `raw`: a hand-built
 * `html([markup])` works and is allowed. The name comes from the kind, so production carries no string.
 */
const tag =
  <T extends ResultType>(type: T) =>
  (strings: TemplateStringsArray, ...values: unknown[]): TemplateResult<T> => {
    if (__DEV__ && !Array.isArray(strings)) {
      const name = ['html', 'svg', 'mathml'][type - 1];
      throw new TypeError(misuse(name, 'tag-called', __DEV__ && SHARED.tagCalled(name, typeof strings === 'string' ? JSON.stringify(strings) : String(strings), '<p>hi</p>')));
    }
    return { ['_$litType$']: type, strings, values };
  };

/** The `html` tagged template. */
export const html = tag(1);
/** The `svg` tagged template — markup parsed as SVG, for a fragment that is not inside an `<svg>` element. */
export const svg = /* @__PURE__ */ tag(2);
/** The `mathml` tagged template — markup parsed as MathML, for a fragment that is not inside a `<math>` element. */
export const mathml = /* @__PURE__ */ tag(3);
