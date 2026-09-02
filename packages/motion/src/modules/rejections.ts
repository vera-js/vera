/**
 * Refusals a module makes at runtime, so they reach `MotionInstance.rejected`.
 *
 * The README tells anyone whose element is not animating to check `rejected`,
 * and says it lists **every** refused attribute. It did not: it is built from
 * the *parse* result, and a module refuses much later — `frame` on a `<div>`,
 * a `frame-url` the origin policy rejected, text with nested markup that
 * cannot be split. All of those warned to the console and left `rejected`
 * empty, which is worse than saying nothing: the GUI this library exists for
 * renders `rejected` and cannot see a console at all.
 *
 * Its own file, and a deliberately tiny one. `schema.ts` is where a shared
 * registry would naturally live, but every module imports from it **as a type
 * only** — a runtime import would drag the whole animation table into each
 * module's bundle, which is the 706-byte mistake `namespace.ts` exists to
 * avoid. Nothing here imports anything.
 *
 * Keyed weakly by node, so a removed element takes its diagnostics with it and
 * this can never be the thing that keeps a detached tree alive.
 */
const REJECTIONS = new WeakMap<Element, Set<string>>();

/**
 * And which elements those are, weakly, because a `WeakMap` cannot be walked.
 *
 * The instance builds `rejected` from the elements it adopted plus the ones it
 * dropped — and a module refuses things about neither. `split` is keyed by the
 * **container**, whose bare marker is optional, so a paragraph written
 * `data-vera-motion-split="words"` with no `data-vera-motion` is in no list the
 * instance keeps: every refusal about it — nested markup, an unknown mode, the
 * piece cap — was recorded here and read by nobody, while the README told
 * people that is where to look.
 *
 * `WeakRef`, so this is still never the thing keeping a removed element alive,
 * and the dead entries are dropped when the list is next read.
 *
 * What bounds it, since nothing prunes it on a page that never reads
 * `rejected`: one entry per *node*, pushed on that node's **first** refusal
 * only — the early return below is what makes that true. A page with nothing
 * wrong with it never grows this at all, and one with mistakes grows it by the
 * number of distinct elements that were ever wrong, not by the number of
 * refusals. The editor case that would otherwise be alarming — an attribute
 * rewritten on every keystroke — is the same node every time.
 */
const REJECTED_NODES: Array<WeakRef<Element>> = [];

/**
 * Records that a module refused something on this element.
 *
 * Idempotent by design — `apply` runs every frame, and a refusal that appended
 * per frame would turn a diagnostic list into a leak. The `Set` is what makes
 * calling this on a hot path safe.
 *
 * @param node the element the refusal was about
 * @param reason the attribute and why, phrased as the reader will see it
 */
export const reject = (node: Element, reason: string): void => {
  const existing = REJECTIONS.get(node);
  if (existing) {
    existing.add(reason);
    return;
  }
  REJECTIONS.set(node, new Set([reason]));
  REJECTED_NODES.push(new WeakRef(node));
};

/**
 * Forgets what was refused about one element.
 *
 * A refusal is about the markup as it was when it was read, and `collect()`
 * reads it again: a paragraph whose nested markup has since been removed, a
 * `split` mode that was a typo and is not any more. Without this the reason
 * outlived the mistake, on the list a GUI renders as its error state — the same
 * failure `applyChanges` fixed for *parse-time* reasons, in the half a module
 * owns.
 *
 * The node stays in the list above. It costs one `WeakRef`, and dropping it
 * would mean a scan; being listed with nothing to report is harmless, because
 * `rejectionsFor` answers with an empty array.
 *
 * @param node the element to forget
 */
export const forgetRejections = (node: Element): void => {
  REJECTIONS.delete(node);
};

/**
 * Every element a module has refused something on and that is still alive.
 *
 * For the instance to find the ones it does not otherwise know about. Prunes
 * as it goes, so the list cannot grow without bound on a page that mints and
 * discards elements.
 *
 * @returns the live nodes, in the order they were first refused
 */
export const rejectedNodes = (): Element[] => {
  const alive: Element[] = [];
  for (let i = 0; i < REJECTED_NODES.length; i++) {
    const node = REJECTED_NODES[i]!.deref();
    if (node) alive.push(node);
  }
  if (alive.length !== REJECTED_NODES.length) {
    REJECTED_NODES.length = 0;
    for (const node of alive) REJECTED_NODES.push(new WeakRef(node));
  }
  return alive;
};

/**
 * What modules have refused on this element, for the instance to merge in.
 *
 * @param node the element to read
 * @returns the reasons, or an empty array
 */
export const rejectionsFor = (node: Element): readonly string[] => {
  const found = REJECTIONS.get(node);
  return found ? [...found] : [];
};

/**
 * Problems with no element to hang them on.
 *
 * Wiring happens before any instance exists — a module handed to `wireMotion`,
 * or an option handed to a module's factory — so there is no `rejected` list to
 * push to and no node to key one by. `createMotion` folds these into its own,
 * which is the list the GUI renders and the one the README sends people to.
 *
 * Here rather than in `schema.ts` because a module must be able to reach it: a
 * module imports `schema.ts` **as a type only**, and a runtime import there
 * would drag the whole animation table into its bundle. That is the same reason
 * this file exists at all.
 */
const PAGE_PROBLEMS: string[] = [];

/**
 * Records a problem that belongs to the page rather than to an element.
 *
 * @returns a retraction, for the problems that can stop being true.
 *
 * Most cannot: a module wired wrongly stays wired wrongly, and the caller
 * ignores this. But `@verajs/motion/paint`'s slot table is emptied by the
 * `forget` insert when no instance is left animating the page, and its "more
 * than N distinct values" problem is then false — while `rejected` went on
 * reporting it, which is the stale-diagnostic shape this library refuses
 * everywhere else (see `markUnfinishable`: `reject` is append-only by design,
 * so it is the wrong shape for a condition that can stop being true).
 *
 * A returned closure rather than a `forgetPageProblem(reason)` taking the text
 * again: the message is built from the module's own constants, and asking a
 * caller to reproduce it exactly would be a second copy to keep in step.
 */
export const pageProblem = (reason: string): (() => void) => {
  PAGE_PROBLEMS.push(reason);
  console.warn(`@verajs/motion: ${reason}`);
  return () => {
    const at = PAGE_PROBLEMS.indexOf(reason);
    if (at >= 0) PAGE_PROBLEMS.splice(at, 1);
  };
};

/** Everything recorded that way, for an instance to report. */
export const pageProblems = (): readonly string[] => PAGE_PROBLEMS;
