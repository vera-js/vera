/**
 * The preset pack — ten named motion values, wired like any other vocabulary.
 *
 * **These are AN example, not THE list.** A preset is the most project-specific thing in this
 * package: a site's house reveal is not ours to guess, and the ten below are a starting vocabulary
 * rather than a standard.
 *
 *   wireDirectives([motion, presets]);            // the shipped ten
 *   wireDirectives([motion, presets(house)]);     // yours, MERGED over ours
 *
 * **A preset is a motion value with a name**, and that is the whole design: the entries below are
 * the same shape as the attribute they expand into, so anything writable in markup is writable in a
 * preset and there is no second format to learn or keep in step. That includes SETTINGS, which is
 * what makes a pack worth shipping rather than a snippet worth copying — one word can carry a
 * project's whole motion character.
 *
 * **`presets(table)` merges rather than replaces**, key by key, yours winning. Two reasons, and the
 * second is the one that decided it:
 *
 * Overriding one preset is the common intent — `presets({ 'fade-up': … })` means "these ten, with
 * fade-up changed", and replace-by-default would silently lose the other nine.
 *
 * And chaining two packs instead would have reintroduced an ordering rule at the wiring level:
 * `[motion, presets, presets(house)]` and `[motion, presets(house), presets]` would resolve a
 * collision differently with nothing on the page saying which won. That is the same invisible
 * order-dependence the expansion pass exists to remove one level down, and removing it there while
 * adding it here would have been silly. Explicit beats inherited, key by key, at BOTH levels — one
 * rule, stated once.
 *
 * To inherit nothing, use the function that means that: `motionExtension({ on: 'preset', fn })`
 * never references this table, so it also drops out of the bundle. A pack declares its intent by
 * which function it calls rather than by a flag.
 */

/**
 * One preset, shaped exactly like the value it stands for: animated properties under `keyframes`,
 * settings beside it. The index signature is the settings half — it cannot be narrower without
 * restating the settings table here, which a wired pack may have extended anyway.
 */
export interface Preset {
  readonly keyframes?: Readonly<Record<string, string>>;
  readonly [setting: string]: unknown;
}

export type PresetTable = Readonly<Record<string, Preset>>;

/**
 * Deliberately keyframes-only, all ten. A preset that carried a trigger would be making a decision
 * about a page it has never seen, and these are the generic vocabulary — `fade-up` means "fade and
 * rise", not "fade and rise 85% down the screen". A HOUSE pack is where triggers belong, because
 * that is written by someone who knows the page.
 */
export const PRESETS: PresetTable = {
  'fade': { keyframes: { opacity: '0% 0, 100% 1' } },
  'fade-up': { keyframes: { opacity: '0% 0, 100% 1', 'translate-y': '0% 40px, 100% 0px' } },
  'fade-down': { keyframes: { opacity: '0% 0, 100% 1', 'translate-y': '0% -40px, 100% 0px' } },
  'fade-left': { keyframes: { opacity: '0% 0, 100% 1', 'translate-x': '0% 40px, 100% 0px' } },
  'fade-right': { keyframes: { opacity: '0% 0, 100% 1', 'translate-x': '0% -40px, 100% 0px' } },
  'zoom-in': { keyframes: { opacity: '0% 0, 100% 1', scale: '0% 0.8, 100% 1' } },
  'zoom-out': { keyframes: { opacity: '0% 0, 100% 1', scale: '0% 1.2, 100% 1' } },
  'slide-up': { keyframes: { 'translate-y': '0% 100px, 100% 0px' } },
  'slide-down': { keyframes: { 'translate-y': '0% -100px, 100% 0px' } },
  'blur-in': { keyframes: { opacity: '0% 0, 100% 1', blur: '0% 12px, 100% 0px' } },
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
