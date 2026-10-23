import { effect, inserts } from '@verajs/core';
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
 *
 * Additive, like `hydration`: it imports no renderer and reaches the one wired through its hand-off (`$H`).
 */
export const portal = (target: Element | DocumentFragment, template: unknown): void => {
  if (onServer) return;
  let part: ChildPart | undefined;
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
      const value = typeof template === 'function' ? (template as (change: unknown) => unknown)(change) : template;
      if (part === undefined) {
        const doc = target.ownerDocument!;
        part = new (handoff[HANDOFF_CHILD_PART] as Part)(doc.createComment(''), doc.createComment(''));
        target.append(part.$s!, part.$e!);
      }
      (handoff[HANDOFF_COMMIT_AS] as CommitAs)(target, part, value);
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
      (handoff[HANDOFF_COMMIT_AS] as CommitAs)(target, part, null);
      part.$s!.remove();
      (part.$e as ChildNode).remove();
      part = undefined;
    },
    { priority: 50 }
  );
};
