/**
 * The motion pack's shared types — the import-graph ROOT.
 *
 * This module imports nothing from inside the pack (CODE-PRINCIPLES §1, Types): every arrow points
 * in, none point out, so no import cycle can pass through here. Cross-file and public types belong
 * in this file; a type one file uses stays in that file, unexported.
 *
 * Seeded by the write-path build (registry first); the vocabulary types spread across `schema.ts`,
 * `parse.ts`, `runtime.ts` and `region.ts` migrate here stage by stage as the rewrite reshapes
 * them — each moves once, when it changes anyway, rather than twice.
 */

/** A tree generated rules are delivered into. Keyframe names resolve per tree scope (measured:
 *  `tests/browser/keyframes-tree-scope.test.js`), so this is the registry's unit of adoption. */
export type SheetRoot = Document | ShadowRoot;

/**
 * One generated element's variable, as the driver sees it — the NARROW slice, deliberately: the
 * driver ticks potentially every frame, and handing it the whole runtime element would couple the
 * hot loop to everything. Mutated in place, one allocation per element for its whole life.
 *
 * `written` is null until the first write, which is how "paint the initial state immediately"
 * and "chase from where you are" stay distinguishable without a flag.
 */
export interface Driven {
  readonly node: HTMLElement;
  /** The custom property this element's animation seeks by — `--vd-p`, or the author's rename. */
  readonly varName: string;
  written: number | null;
  target: number;
  /** `idle` writes land immediately; `chase` eases toward target; `ramp` is a play's clock. */
  mode: 'idle' | 'chase' | 'ramp';
  /** Chase time-constant, seconds — derived from `inertia` (≈settled at 3τ). */
  tau: number;
  rampFrom: number;
  rampStart: number;
  rampDuration: number;
  /**
   * The element's contained tick closure, or null — called with every value this slice writes,
   * so a tick sees exactly the number CSS sees, at the same moment, post-chase and post-ramp.
   * Pre-bound by the runtime (containment and reporting live there); the loop just calls it.
   */
  readonly tick: ((progress: number) => void) | null;
}
