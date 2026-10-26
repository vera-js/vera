import { effect, inserts, untrack } from '@verajs/core';
import { diagnostic } from '@verajs/shared-utils';
import { HANDOFF_CHILD_PART, HANDOFF_COMMIT_AS, HANDOFF_PROTOCOL, PROTOCOL } from './kinds.js';
import { PROSE } from './portal-diagnostics.js';
import type { ChildPart } from './renderer.js';

/** What this entry reads off core's registry: the renderer's hand-off and core's settle. `$`-named — never mangled. */
type Registry = {
  $H?: unknown[];
  $so?: (hook: unknown, all?: boolean) => void;
};
type Part = new (start: Comment, end: Comment) => ChildPart;
type CommitAs = (root: Node, part: ChildPart, value: unknown) => void;

/**
 * **A server registers nothing** — `@verajs/ssr` sets this public flag at import, before anything renders (the renderer
 * reads it the same way). A server turn runs a setup's effects, and with no client renderer there every request said
 * `portal-no-renderer` (measured 2026-10-22); a portal has nothing to draw there, and hydration nothing to adopt.
 */
const onServer = (globalThis as { __veraSsrShimmed?: boolean }).__veraSsrShimmed === true;
/** Said once per page: a portal with no renderer of this release wired draws nothing (core's own `no-renderer` covers a component's render, not this). */
let warned = false;

/**
 * **`portal(target, template)` — draws into ANOTHER element, from a component's setup** (2026-10-22, the API
 * distillation: it replaced `useRender`'s one job no returned render can do). A modal on `document.body`, a tooltip
 * in an overlay layer, a row in another component's light DOM.
 *
 * - **Its own range.** Two comments, appended to `target`, bound what it draws, so any number share one target (two
 *   components drawing into `document.body` with `renderInto` — one root per container — replaced each other).
 * - **The render's slot.** It runs at the render's priority (50): a keyed `.map` keeps its rows with their items, it is
 *   drawn before the component's layout effects, and what its draw made and no longer reaches (an automatic list, a
 *   computed) is freed after each draw, as the component's own render frees it.
 * - **Owned by the component being set up**, whose removal takes its content and markers out of `target`; a paused
 *   component (`persist`) takes them out too, and draws afresh when it is back. A cross-window MOVE of the component
 *   leaves it where it is: `target` is where it was asked to draw.
 * - **Light DOM.** `target` itself, never its shadow root: into a shadow host it is the host's light content, slotted
 *   where the host's template says.
 * - **The client only.** A server renders a component's own template; a portal registers nothing there, so hydration
 *   finds no range to adopt and the client draws it once.
 * - **A target FUNCTION follows** (R4, Brian 2026-10-25): `portal(() => host.ownerDocument.body, …)` is evaluated at setup
 *   and again whenever what it reads changes or its component moves into another window (a cross-window move re-runs effect
 *   priority), and a different answer MOVES the drawn range into the new target — never a redraw, so components inside
 *   keep their state. A popped-out panel's modal then opens in the pop-out. A plain element target never moves.
 *
 * Additive, like `hydration`: it imports no renderer and reaches the one wired through its hand-off (`$H`).
 */
type Target = Element | DocumentFragment;
/**
 * **No target, or a dead one, leaves the range WHERE IT IS** (2026-10-25): a falsy answer, or a target whose window is gone
 * (a closed pop-out: no live `defaultView`), moves nothing — so nothing is removed and the components inside keep their
 * state (holding the range in a detached fragment would be a REMOVAL, which tears them down) — and the next real target
 * gets it. Nothing throws.
 */
const usable = (t: Target | null | undefined): t is Target => {
  const view = t?.ownerDocument?.defaultView;
  return view != null && !view.closed;
};
export const portal = (target: Target | (() => Target | null | undefined), template: unknown): void => {
  if (onServer) return;
  let part: ChildPart | undefined;
  /** Where it draws now: a function target is read once here, untracked, so the draw does not subscribe to it. */
  let current: Target;
  if (typeof target === 'function') {
    const first = untrack(target);
    /** No usable target yet: drawn into a fragment of THIS realm's document until one exists — portal is handed no element to take one from. */
    current = usable(first) ? first : document.createDocumentFragment();
  } else current = target;
  /** The last value drawn, for a redraw when a dead window destroyed the range (below). */
  let last: unknown;
  const registry = inserts as unknown as Registry;
  const hook = effect(
    (change) => {
      const handoff = registry.$H;
      if (handoff === undefined || handoff[HANDOFF_PROTOCOL] !== PROTOCOL) {
        if (!warned) {
          warned = true;
          console.warn(__DEV__ ? diagnostic('renderer', 'portal', 'portal-no-renderer', __DEV__ && PROSE['portal-no-renderer']()) : '[vera] portal-no-renderer');
        }
        return;
      }
      const value = (last = typeof template === 'function' ? (template as (change: unknown) => unknown)(change) : template);
      if (part === undefined) {
        const doc = current.ownerDocument!;
        part = new (handoff[HANDOFF_CHILD_PART] as Part)(doc.createComment(''), doc.createComment(''));
        current.append(part.$s!, part.$e!);
      }
      (handoff[HANDOFF_COMMIT_AS] as CommitAs)(current, part, value);
      registry.$so?.(hook);
    },
    { priority: 50 }
  );
  /**
   * The removal: a second hook, reading nothing, whose cleanup runs only when the owner retires or pauses. At 50 too —
   * a cross-window move re-runs the layout (60) and effect (75) priorities, and this must not run then.
   */
  effect(
    () => () => {
      if (part === undefined) return;
      const handoff = registry.$H!;
      (handoff[HANDOFF_COMMIT_AS] as CommitAs)(current, part, null);
      part.$s!.remove();
      (part.$e as ChildNode).remove();
      part = undefined;
    },
    { priority: 50 }
  );
  /**
   * **A function target follows** — only then: a third hook, at EFFECT priority (75) so a cross-window move re-runs it,
   * re-reads the target (tracked, so a store it reads moves it too) and, when the answer changed, moves the range — the
   * markers and what lies between them — into it. Moving keeps every node, components included (R4).
   */
  if (typeof target === 'function')
    effect(() => {
      const next = target();
      if (!usable(next) || next === current) return;
      const from = current;
      current = next;
      if (part === undefined) return;
      /**
       * **The range is gone** — a window that died took its document's nodes (jsdom empties a removed iframe's document;
       * browsers keep them): the markers are no longer siblings. Drawn afresh into the new target from the last value; the
       * components inside are set up again in this one case.
       */
      if (part.$s!.parentNode === null || part.$s!.parentNode !== part.$e!.parentNode) {
        const handoff = registry.$H!;
        const doc = next.ownerDocument!;
        part = new (handoff[HANDOFF_CHILD_PART] as Part)(doc.createComment(''), doc.createComment(''));
        next.append(part.$s!, part.$e!);
        (handoff[HANDOFF_COMMIT_AS] as CommitAs)(next, part, last);
        return;
      }
      const nodes: Node[] = [];
      for (let n: Node | null = part.$s!; n !== null; n = n.nextSibling) {
        nodes.push(n);
        if (n === part.$e) break;
      }
      /**
       * Within ONE document, `moveBefore` (Chromium, Firefox) keeps what an insertion would reset — focus, a playing media
       * element, an iframe — so a reactive target switching containers loses none of it. Across documents, or where it is
       * absent (WebKit), `append`: a cross-document insertion adopts.
       */
      const move = (next as Partial<{ moveBefore: (n: Node, c: Node | null) => void }>).moveBefore;
      if (move !== undefined && from.isConnected && next.isConnected && part.$s!.getRootNode() === next.getRootNode())
        for (const n of nodes) move.call(next, n, null);
      else next.append(...nodes);
    });
};
