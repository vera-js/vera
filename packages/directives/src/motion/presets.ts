/**
 * The preset pack — ten named motion values, wired like any other vocabulary.
 *
 * **These are AN example, not THE list.** A preset is the most project-specific thing in this
 * package: a site's house reveal is not ours to guess, and the ten below are a starting vocabulary
 * rather than a standard. Registering your own is the same one-liner this file uses, and replacing
 * ours wholesale is `wireDirectives([motion, myPresets])` with ours never imported.
 *
 *   import { motion, presets } from '@verajs/directives/motion';
 *   wireDirectives([motion, presets]);
 *
 *   // or your own, instead of or beside ours
 *   const house = vocabularyConnector({ on: 'preset', fn: (name) => TABLE[name] ?? null });
 *
 * **A preset is a motion value with a name**, and that is the whole design: the object below is the
 * same shape as the attribute it expands into, so anything writable in markup is writable in a
 * preset and there is no second format to learn or keep in step.
 *
 * That includes SETTINGS, which is what makes a pack worth shipping rather than a snippet worth
 * copying — `hero-in` can encode keyframes, ease, trigger and duration together, and one word then
 * carries a project's whole motion character. It is also how the eager default trigger is answered:
 * a play with no `scroll` fires the instant the element's first pixel clears the bottom of the
 * viewport, so every preset that plays names a later trigger itself rather than the library keeping
 * a second default for the case.
 *
 * Explicit keys on the element always win — the expansion runs BEFORE anything else is read, so
 * `data-vd-motion="{ preset: 'fade-up', inertia: 0.5 }"` is fade-up with your inertia, whichever
 * order the two keys are written in.
 */
/**
 * **No import from `./index.js`.** The connector is declared there, beside `easings` and `paint`,
 * because building it here would close a cycle — index re-exports `presets`, so calling
 * `vocabularyConnector` at this module's scope read it before initialisation and took the whole
 * bundle down at import time. This file owns the table and the lookup; index owns the wiring.
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

/**
 * Deliberately keyframes-only, all ten. A preset that carried a trigger would be making a decision
 * about a page it has never seen, and these are the generic vocabulary — `fade-up` means "fade and
 * rise", not "fade and rise 85% down the screen". A HOUSE pack is where triggers belong, because
 * that is written by someone who knows the page.
 */
export const PRESETS: Readonly<Record<string, Preset>> = {
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
 * `hasOwnProperty` rather than a lookup, so `constructor` and the other prototype keys cannot
 * masquerade as a preset. The value is attribute text on a page anyone with CMS access can edit.
 */
export const lookUpPreset = (name: string): Preset | null =>
  Object.prototype.hasOwnProperty.call(PRESETS, name) ? PRESETS[name]! : null;
