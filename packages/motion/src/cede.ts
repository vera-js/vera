/**
 * CEDE — the one table that answers "how much of this element's animation can CSS own?"
 *
 * Every cession this engine performs — transition-play, the when-fold, tier C's cascade
 * variable, tier N's native timeline — is a DECISION with conditions, and conditions that live
 * as inline `&&` chains grow haphazardly: the tier block had sixteen clauses across two
 * decisions before this table, each documented by an adjacent comment instead of a name. Here
 * every condition is a NAMED GUARD that answers with a REFUSAL REASON or null, the decision is
 * a fold over its guard list, and introducing a new fold when a new CSS capability ships means
 * ADDING A ROW, not threading another `&&` (the owner's rule, 2026-09-10).
 *
 * Two deliberate boundaries:
 * - **This table is internal, never wireable.** Emission is parity-locked with the PHP twin;
 *   a registry door for folds would let a page change what the spec pins. New rows arrive by
 *   spec revision, both engines together.
 * - **Emission-time decisions stay in generate.ts** (the transition gauntlet's refusal ORDER is
 *   corpus-pinned; the when-fold is part of transition emission). What lives here is the
 *   RUNTIME dispatch — which tier an already-generated element rides — reading generated
 *   artifacts (`nativeRule !== ''`) rather than re-deriving generation's reasoning, so the two
 *   layers cannot drift.
 *
 * The reasons are strings for a reason: `explainCession(...)` hands an inspector (Studio's
 * hook) the full dispatch — "tier J because: inertia is 0.12" — for free, from the same table
 * the decision used. A dev tool that reads the real dispatch can never lie about it.
 */
import { PROGRESS_PROPERTY } from './registry.js';
import type { Generated, ParsedElement, RuntimeSettings } from './types.js';

interface CessionContext {
  readonly parsed: ParsedElement;
  readonly generated: Generated;
  readonly settings: RuntimeSettings;
  readonly node: Element;
  /** Environment probes injected by the runtime (memoized there; this table stays pure). */
  readonly env: {
    readonly supportsViewTimeline: boolean;
    readonly scrollerScrolls: boolean;
    readonly unobstructed: boolean;
    readonly hasFunction: boolean;
  };
}

type Guard = readonly [name: string, refuses: (ctx: CessionContext) => string | null];

/** Tier C — the cascade computes the element's number from the scroller's one written var. */
const CASCADE_GUARDS: readonly Guard[] = [
  ['seek-mode', ({ generated }) =>
    generated.mode === 'seek' && generated.groups.length > 0 ? null : 'not a seek animation'],
  ['no-function', ({ env }) => env.hasFunction ? 'a registered function rides the number' : null],
  ['no-play', ({ parsed }) =>
    typeof parsed.settings['play'] === 'number' ? 'play walks the timeline in one step' : null],
  ['no-when', ({ parsed }) =>
    typeof parsed.settings['when'] === 'string' ? 'a gate needs the JS watch' : null],
  /** SPEC-POINTER §5: there is no CSS pointer timeline. When the platform ships one, this row
   *  comes out — the table doing its job. */
  ['no-pointer', ({ parsed }) =>
    typeof parsed.settings['pointer'] === 'string' ? 'a pointer source needs its JS driver' : null],
  ['no-run-once', ({ parsed }) =>
    parsed.settings['run-once'] === true ? 'a latch is a memory, and the cascade has none' : null],
  ['base-variable', ({ generated }) =>
    generated.varName === PROGRESS_PROPERTY && generated.vars.length === 1
      ? null : 'renamed or per-category variables need their own drivers'],
  ['zero-inertia', ({ parsed, settings }) =>
    Number(parsed.settings['inertia'] ?? settings.inertia) === 0
      ? null : 'inertia is a JS chase by definition'],
];

/** Tier N — the native view() timeline; rides ON tier-C eligibility (same "no JS number"). */
const NATIVE_GUARDS: readonly Guard[] = [
  ['no-stagger', ({ parsed }) => parsed.stagger === undefined ? null : 'view() has no offset'],
  ['ranged-rule', ({ generated }) =>
    generated.nativeRule !== '' ? null : 'no static animation-range spelling exists (generation refused)'],
  ['viewport-scroller', ({ generated, settings }) =>
    settings.scrollElement == null || !generated.nativeRule.includes('vh')
      ? null : 'vh ranges measure viewports; this scroller is not the viewport'],
  ['vertical', ({ settings }) =>
    settings.scrollDirection !== 'horizontal' ? null : 'the rule says view(block)'],
  ['engine-support', ({ env }) => env.supportsViewTimeline ? null : 'no animation-timeline: view()'],
  ['live-scroller', ({ env }) =>
    env.scrollerScrolls ? null : 'an inactive timeline paints nothing — worse than tier C'],
  ['unobstructed', ({ env }) =>
    env.unobstructed ? null : 'an overflow ancestor would capture view() and freeze it'],
];

const firstRefusal = (guards: readonly Guard[], ctx: CessionContext): string | null => {
  for (const [name, refuses] of guards) {
    const reason = refuses(ctx);
    if (reason !== null) return `${name}: ${reason}`;
  }
  return null;
};

/** The dispatch: null = ceded; a string = the NAMED first refusal (inspector-ready). */
export const cessions = (ctx: CessionContext): { cascade: string | null; native: string | null } => {
  const cascade = firstRefusal(CASCADE_GUARDS, ctx);
  const native = cascade ?? firstRefusal(NATIVE_GUARDS, ctx);
  return { cascade, native };
};
