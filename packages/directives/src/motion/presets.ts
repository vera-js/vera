import type { Preset, PresetTable } from './types.js';


/**
 * **Every one of these carries a trigger, and that is the point.** They were keyframes-only at
 * first, on the reasoning that a trigger is a decision about a page the pack has never seen. Brian's
 * objection, and it is correct: the keyframes are equally such a decision — why 40px of travel? —
 * and declining to choose does not leave the preset neutral, it leaves it BROKEN. Without a trigger
 * a play fires the instant the element's first pixel clears the bottom of the viewport, so the
 * animation is over before anyone looks at it. A preset that does not work on its own is not a
 * preset, it is a fragment.
 *
 * `scroll: '85%'` — the element's top 85% down the screen, which is where a reveal reads as
 * deliberate rather than as something that happened off-screen. `play: 0.6` because these are
 * reveals rather than scrubs: crossing the line runs the animation, and crossing back up past it
 * reverses. Not `run-once`, which is the opt-out for anyone who wants the latch.
 *
 * Anything here is overridable per element and per pack — `{ preset: 'fade-up', scroll: '60%' }` is
 * fade-up arriving earlier, because the expansion runs before every other key.
 */
const REVEAL = { scroll: '85%', play: 0.6 } as const;
/**
 * EASES, since the lift (ease composes with play now): entrances decelerate (`ease-out` — the
 * element arrives and settles), the zooms carry a small back-out overshoot (the pop a scale
 * wants), and the slides stay `ease-out` rather than back-out because 100px of travel
 * overshooting reads as a mistake where 0.8→1 of scale reads as life. A preset is a taste
 * decision by design — override any of it with `presets(table)`.
 */
export const PRESETS: PresetTable = {
  'fade': { keyframes: { opacity: '0% 0, 100% 1' }, ease: 'ease-out', ...REVEAL },
  'fade-up': { keyframes: { opacity: '0% 0, 100% 1', 'translate-y': '0% 40px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'fade-down': { keyframes: { opacity: '0% 0, 100% 1', 'translate-y': '0% -40px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'fade-left': { keyframes: { opacity: '0% 0, 100% 1', 'translate-x': '0% 40px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'fade-right': { keyframes: { opacity: '0% 0, 100% 1', 'translate-x': '0% -40px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'zoom-in': { keyframes: { opacity: '0% 0, 100% 1', scale: '0% 0.8, 100% 1' }, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', ...REVEAL },
  'zoom-out': { keyframes: { opacity: '0% 0, 100% 1', scale: '0% 1.2, 100% 1' }, ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)', ...REVEAL },
  'slide-up': { keyframes: { 'translate-y': '0% 100px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'slide-down': { keyframes: { 'translate-y': '0% -100px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
  'blur-in': { keyframes: { opacity: '0% 0, 100% 1', blur: '0% 12px, 100% 0px' }, ease: 'ease-out', ...REVEAL },
};

/**
 * **`hasOwnProperty`, not a bare lookup**, and this is the reason `presets(table)` exists at all
 * rather than leaving everyone to write their own three-line resolver.
 *
 * A preset name is attribute text, editable by anyone with CMS access, and `TABLE[name]` answers
 * `Object.prototype.constructor` for `"constructor"` — an object that is not a preset, reaching the
 * expansion as though it were one. Ours is safe because it is written here once; a pack author
 * hand-rolling the obvious version would not be. Building the resolver for them removes the footgun
 * from every pack anyone writes.
 */
const own = (table: PresetTable, name: string): Preset | null =>
  Object.prototype.hasOwnProperty.call(table, name) ? table[name]! : null;

/** The shipped ten, for the bare `presets`. */
export const lookUpPreset = (name: string): Preset | null => own(PRESETS, name);

/** A table merged over the shipped ten: theirs answers first, ours fills the rest. */
export const lookUpMerged = (table: PresetTable) => (name: string): Preset | null =>
  own(table, name) ?? own(PRESETS, name);
