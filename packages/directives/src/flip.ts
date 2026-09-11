/**
 * THE FLIP DOOR — one animated-commit gate for every directive that mutates visible DOM.
 *
 * `list` reorders and hides, `fetch` swaps a region, and both answer the same two questions:
 * *should this commit animate at all*, and *how does each touched element travel*. The first is
 * the GUARD TABLE below — every condition a NAMED GUARD returning a refusal reason or null, the
 * decision a fold, exactly the cession-table shape motion's cede.ts set (the owner's rule:
 * tables, not conditionals; a new condition is a ROW). The fold helper is copied from cede
 * rather than shared, deliberately: cede is internal to a parity-locked twin and six lines is
 * below the abstraction threshold — copy the pattern, never the coupling. The second question
 * is TREATMENT: kind → policy, one row per way a change can move.
 *
 * The mechanics are the PLATFORM's FLIP — `document.startViewTransition` — with the guards this
 * road was measured to need (omni built it first, buried it, and their burial notes shaped each
 * one; the transient-name claim was re-measured on our side before shipping):
 *
 * - TRANSIENT NAMES: `view-transition-name` is set only on touched elements, only for the
 *   transition's life, cleared after `finished` — measured clean (no containing-block shift
 *   while named, no residue, guard path inert). Prefixed `vm-fx-` so the scheme can never
 *   collide with a host platform's own VT names.
 * - SYNC-COMPUTE, ASYNC-COMMIT: the VT callback runs after directive scope is gone — omni's
 *   programs broke exactly there. A `commit` must close over PLAIN DATA ONLY.
 * - SUPERSESSION: the async callback can lose a race with a newer commit; `claimCommit` hands
 *   the caller a still-current predicate so a stale callback degrades to a quiet no-op.
 */
import type { ListChange } from './types.js';

/** kind → policy. `wave`: rides the stagger — a property of items that TRAVEL (the reversal's
 *  synchronised centre-crossing is what the wave exists to break); fades happen together,
 *  because a filter is ONE coherent change and waved fades read as a laggy queue (found live);
 *  a swap is one region morphing old-to-new — the platform's crossfade IS its leave animation. */
const TREATMENT: Record<ListChange['kind'], { readonly wave: boolean }> = {
  move: { wave: true },
  fade: { wave: false },
  swap: { wave: false },
  enter: { wave: false },
};

interface FlipContext {
  readonly doc: Document;
  /** The directive's own opt-in (`animate: true`). */
  readonly animate: boolean;
  /** True on the pass that ESTABLISHES the page (activation, URL restore, `on: 'load'`) —
   *  establishment answers no one, so it never animates (found live: server order visibly
   *  shuffling into the URL's filters on every refresh). */
  readonly first: boolean;
  /** False while a continuous input (typing) drives the change. */
  readonly discrete: boolean;
  readonly changes: readonly ListChange[];
  /**
   * Changes only the COMMIT can produce — elements born inside it (`enter`). Called after
   * `commit`, before the new state is captured, so the names land on the platform's new
   * snapshots; a commit that produced nothing returns []. Never called on the instant path —
   * an element that enters without a transition needs no name.
   */
  readonly after?: () => readonly ListChange[];
}

type StartViewTransition = (cb: () => void) =>
  { finished: Promise<unknown>; skipTransition?: () => void };

const startOf = (doc: Document): StartViewTransition | undefined =>
  (doc as Document & { startViewTransition?: StartViewTransition }).startViewTransition;

type Guard = readonly [name: string, refuses: (ctx: FlipContext) => string | null];

const GUARDS: readonly Guard[] = [
  ['opted-in', ({ animate }) =>
    animate ? null : 'animate is not true'],
  ['not-establishment', ({ first }) =>
    first ? 'a first apply settles the page — it answers no one' : null],
  ['discrete', ({ discrete }) =>
    discrete ? null : 'typing — a document transition per keystroke is the jank omni measured'],
  ['has-changes', ({ changes, after }) =>
    changes.length > 0 || after !== undefined ? null : 'nothing changed'],
  ['platform', ({ doc }) =>
    startOf(doc) ? null : 'no startViewTransition'],
  ['motion-ok', ({ doc }) =>
    doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
      ? 'prefers-reduced-motion: reduce' : null],
];

const firstRefusal = (ctx: FlipContext): string | null => {
  for (const [name, refuses] of GUARDS) {
    const reason = refuses(ctx);
    if (reason !== null) return `${name}: ${reason}`;
  }
  return null;
};

/**
 * Host → the latest commit's sequence number. A transition's callback runs ASYNC — so a rapid
 * second change can land its commit first, and the FIRST transition's queued callback then
 * re-applies its STALE data mid-capture (the live shrink-and-regrow on quick asc/desc toggles).
 * A commit that has been superseded is a NO-OP — the transition still runs, over whatever the
 * newest commit already wrote, which degrades to a quiet crossfade instead of a lie.
 */
const commitSeq = new WeakMap<Element, number>();

/** Claims the next commit on a host; the returned predicate says whether this claim is STILL
 *  the newest when the (possibly async) commit finally runs. */
export const claimCommit = (host: Element): (() => boolean) => {
  const seq = (commitSeq.get(host) ?? 0) + 1;
  commitSeq.set(host, seq);
  return () => commitSeq.get(host) === seq;
};

/**
 * The document's ACTIVE transition, so a discrete change landing mid-flight can SKIP it and run
 * its own. The first guard demoted such commits to instant — correct DOM, wrong theater: the
 * old journey's overlay kept gliding one way while reality snapped the other, and the reveal at
 * overlay-end read as a shrink-and-pop (found live, toggling a sort mid-glide). skipTransition
 * jumps the old overlay to its end, the stale callback still runs (and is a no-op — the
 * versioned commits), and the new transition captures from where things truly are. ONE map for
 * the whole document, across directives: a fetch swap landing mid list-glide coordinates too.
 */
const activeTransition = new WeakMap<Document, { skipTransition?: () => void }>();

/**
 * Commits DOM mutations, animated where the guard table cedes. Returns the NAMED first refusal
 * (inspector-ready, the cede convention) or null when the transition ran — either way `commit`
 * has been called or scheduled, exactly once.
 */
export const commitFlip = (ctx: FlipContext, commit: () => void): string | null => {
  const refusal = firstRefusal(ctx);
  if (refusal !== null) {
    commit();
    return refusal;
  }
  const { doc, changes } = ctx;
  const start = startOf(doc)!;
  /** A change worth animating that lands mid-flight takes the stage over: the old overlay skips
   *  to its end (its stale callback runs and no-ops), and THIS one glides from there. */
  activeTransition.get(doc)?.skipTransition?.();
  /**
   * THE STAGGER — the reversal cure, applied by TREATMENT kind: on a full reversal every
   * mover's mirror path crosses the grid centre at t=50% under one shared clock, so all groups
   * pile into one band and fan back out (the measured "shrink and grow"; synchronised FLIP
   * always does this on opposing states). A few ms of per-group delay turns the crossing into a
   * wave. Only kinds whose treatment says `wave` ride it. Per `::view-transition-group`, which
   * only a stylesheet can reach, so the rules ride the transient names' exact lifecycle.
   */
  const waved = changes.filter((change) => TREATMENT[change.kind].wave).length;
  const step = waved > 1 ? Math.min(40, 260 / (waved - 1)) : 0;
  const rules: string[] = [];
  let wavedAt = 0;
  changes.forEach((change, i) => {
    (change.item as HTMLElement).style.setProperty('view-transition-name', `vm-fx-${i}`);
    if (step > 0 && TREATMENT[change.kind].wave) {
      rules.push(`::view-transition-group(vm-fx-${i}) { animation-delay: ${Math.round(wavedAt++ * step)}ms; }`);
    }
  });
  const stagger = doc.createElement('style');
  stagger.id = 'vm-fx-stagger';
  stagger.textContent = rules.join('');
  if (rules.length) doc.head.appendChild(stagger);
  /** Everything named — pre-known changes AND the commit-born ones — cleared together. */
  const named: Element[] = changes.map((change) => change.item);
  const clear = (vt: unknown) => {
    if (activeTransition.get(doc) === vt) activeTransition.delete(doc);
    for (const item of named) (item as HTMLElement).style.removeProperty('view-transition-name');
    stagger.remove();
  };
  try {
    const vt = start.call(doc, () => {
      commit();
      /** The commit-born changes: named HERE, after the mutation and before the new-state
       *  capture — the only window in which an entering element both exists and can still
       *  make it into the platform's snapshot pairing. */
      for (const change of ctx.after?.() ?? []) {
        (change.item as HTMLElement).style.setProperty('view-transition-name', `vm-fx-${named.length}`);
        named.push(change.item);
      }
    });
    activeTransition.set(doc, vt);
    vt.finished.then(() => clear(vt), () => clear(vt));
  } catch {
    clear(null);
    commit();
  }
  return null;
};
