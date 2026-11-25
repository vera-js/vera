/**
 * **The stepper's look, its own rule set**, adopted by the stepper itself (`adoptOwnSheet`) the first time it serves a
 * number input in a root, so a page that never wires the stepper carries none of it. Keyed as <vera-input>'s look is:
 * our part attributes, zero specificity, `data-vera-look="none"` drops it; the one structural rule is the engine's
 * spinner hidden on the inner input of a box it serves (marked `data-vera-input-stepper` while it does), so there is one
 * stepper, not two, and an input it does not serve keeps the native one.
 */

import { HOVER, RADIUS } from '@verajs/shared-utils';
import { box, part } from '../input/selectors.js';

/** The inner number input of a box the stepper serves (the reset's own key, 0,2,1, and the type). */
const stepped = `${box('[data-vera-input-stepper]')} input[data-vera-input]:not([data-vera-look="none"])[type="number"]`;

/** The root's key for the stepper's rules (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
export const SHEET = '_$veraInputStepper$';

/**
 * A step part, inside the stepper: keyed under the stepper part, so the host's or the stepper's `data-vera-look="none"`
 * drops both halves with it. The stepper is `display: contents` and each part a plain block, so the two are flex items
 * of the box: with the stepper an inline flex box and each part a grid centering a glyph, 200 number inputs' creation
 * read 2.3ms more (headed Chromium), and with the parts written this way their rules read within noise of none at all.
 */
const stepPart = (name: string, more = ''): string =>
  `${part('stepper')}>:where([data-vera-part="${name}"][data-vera-input]:not([data-vera-look="none"])${more})`;

/**
 * A step part while its input is disabled or read-only: a sibling test from the input, not a `:has()` on the box,
 * which every step part asked of its box at creation (4.7ms over 200 number inputs, headed Chromium).
 */
const stepOff = (name: string): string =>
  `:where(:not([data-vera-look="none"])>input[data-vera-input]:is(:disabled,:read-only)~[data-vera-part="stepper"][data-vera-input]>[data-vera-part="${name}"][data-vera-input])`;

/**
 * A step glyph's bar, in the text color. The glyphs are backgrounds, not generated text: a `::before` glyph on each
 * part cost 10.6ms over 200 number inputs (headed Chromium), a box and a shaped run per part.
 */
const BAR = 'linear-gradient(currentColor,currentColor)';

export const LOOK =
  `${stepped}{appearance:textfield}` +
  `${stepped}::-webkit-inner-spin-button{appearance:none;margin:0}` +
  `${part('stepper')}{display:contents}` +
  `${stepPart('step-down')},${stepPart('step-up')}{display:block;flex:none;inline-size:1.5em;block-size:1.5em;` +
  `border-radius:calc(${RADIUS} * .5);cursor:pointer;touch-action:none}` +
  `${stepPart('step-down')}:hover,${stepPart('step-up')}:hover{background-color:${HOVER}}` +
  `${stepPart('step-down')}{background:${BAR} center/.625em .125em no-repeat}` +
  `${stepPart('step-up')}{background:${BAR} center/.625em .125em no-repeat,${BAR} center/.125em .625em no-repeat}` +
  `${stepOff('step-down')},${stepOff('step-up')}{cursor:inherit;background-color:transparent}`;
