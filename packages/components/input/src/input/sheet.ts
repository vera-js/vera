/**
 * **<vera-input>'s look, one rule set**, adopted by the element into the root it renders in (`adoptOwnSheet`), so the
 * clear and reveal buttons are seen whether or not the app wired `@verajs/styles` (without it they would be empty
 * buttons, named but invisible).
 *
 * - **Keyed on our own part attributes, never the tag**, so `defineAs('my-input')` looks the same: the part's name
 *   AND `data-vera-input`, the mark every part this element writes carries. Part names are one vocabulary shared by
 *   every component, so a rule on the name alone styled any component's `clear` (a browser row, red on all three).
 * - **Zero specificity** (`:where`), so any rule a page writes wins (a utility class on a part included).
 * - **`data-vera-look="none"`** on the host or on a part drops the look; the parts stay.
 * - **`[hidden]` is never overridden**: an author `display` beats the UA's `[hidden]{display:none}` at any
 *   specificity, so every rule that sets `display` skips a hidden part.
 * - The buttons' glyphs are generated content with empty alt text (`/ ""`): each button is named by its `aria-label`,
 *   and copying never picks a glyph up.
 * - **The box is the host** (its mark `data-vera-input-host`): a hairline border, the shared radius, surface and text
 *   tokens, 2.25em tall, with the input borderless inside and the parts beside it, so the clear and reveal buttons sit
 *   inside the box. 36px at a 16px page: the survey's default control height (shadcn/ui, Mantine).
 * - **Scale** sets the box's font size: `md` the page's (1em), `sm` and `lg` around it, so the three are ordered whatever
 *   the page's size; the input inherits it (an `<input>` does not inherit a font by itself, so the box's rule gives it
 *   `font: inherit`), and the buttons and marks are sized in `em`, so all of it moves together.
 * - **One clear glyph:** while our clear button sits beside a search input, the engine's own cancel button is hidden
 *   (Chromium and WebKit draw one). All three engines keep the rule, Firefox 159 included (measured); it is a rule of
 *   its own, so an engine that ever drops the pseudo-element loses only that rule.
 * - **Reduced motion** keeps "busy" visible (a slow pulse, never nothing); **forced colors** keep the loading mark's
 *   two system colors, so it is still seen to move.
 */

import { BORDER, DANGER, FG, FG_MUTED, FOCUS, HOVER, RADIUS, SURFACE } from '@verajs/shared-utils';

/** The root's key for the input's rules (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
export const SHEET = '_$veraInputLook$';

/** A part, unless the host or the part itself opted out of the look. */
const part = (name: string, more = ''): string =>
  `:where(:not([data-vera-look="none"])>[data-vera-part="${name}"][data-vera-input]:not([data-vera-look="none"])${more})`;

/**
 * The served input, found by our mark (valued with the host's scale), unless it or anything around it opted out of the
 * look. A descendant test, not a child one: the input may sit in a wrapper inside the host.
 */
const served = (value: string, more = ''): string =>
  `:where(input[data-vera-input${value}]:not([data-vera-look="none"],[data-vera-look="none"] *)${more})`;

/**
 * The box: the host, found by its mark (valued with its scale), unless it opted out. The box is the host, not the input,
 * because the clear, reveal and loading parts sit beside the input: a border on the input alone left them outside it.
 */
const box = (more = ''): string => `:where([data-vera-input-host]:not([data-vera-look="none"])${more})`;

/** The box while the input in it matches `state` (`:focus-visible`, `:disabled`, …): the box holds only the served input. */
const boxWhen = (state: string): string => box(`:has(${state})`);

/** The inner input, structurally: above a page's ordinary input rules (see the box's rules). */
const inner = `${box()} input[data-vera-input]:not([data-vera-look="none"])`;

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

const BUTTON =
  'display:inline-grid;place-items:center;box-sizing:border-box;inline-size:1.5em;block-size:1.5em;margin:0;padding:0;' +
  `border:0;border-radius:calc(${RADIUS} * .5);background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer`;

/**
 * The box's rules. Its font size is the scale (`md` the page's, `sm` and `lg` around it), and the input inherits it, so
 * the text, the box and the parts (sized in `em`) move together. The ring is the shared focus ring on the box while
 * focus is anywhere in it (`:focus-within`: the input, and the clear and reveal buttons too, chosen: the focus is in the
 * control), and the input's own outline goes. Not `:has(input:focus-visible)`: the box's focus and outline rules asked
 * through `:has()` cost creation 5-14% over the look-less input (headed Chromium, 200 inputs, four runs), and with
 * `:focus-within` the look reads within noise of it (+0.3%, -2.5%). The two state rules below keep `:has()`: they
 * measured within noise.
 * The border turns `--vera-danger` on a control marked `aria-invalid="true"` or one the user has left invalid
 * (`:user-invalid`, which matches only once the user has committed a change); one rule, the two inside `:is()`, which
 * forgives a selector it does not know (`:has()` does not), so an engine without `:user-invalid` keeps the other. Inside `<vera-field>` the field marks the control
 * `aria-invalid` while it shows an error, so this rule is the one owner of the box's edge.
 *
 * **The inner input's resets are not zero specificity**: its border, background, padding, margin, font and outline must
 * hold for the box to be a box, and a page's ordinary rules (`input {…}`, `.x :where(input)`, Bootstrap's
 * `.form-control`) drew a box inside the box and kept the page's font size, so `sm` and `lg` read alike. So that one rule
 * is keyed `input[data-vera-input]:not(…)` (0,2,1), above those: a rule styling the input inside the box is that
 * mistake. Everything else stays at zero specificity, the parts included (a page's own class on a part is deliberate
 * and wins), and `data-vera-look="none"` still drops all of it.
 */
const BOX =
  `${box(':not([hidden])')}{display:inline-flex;align-items:center;gap:.25em;vertical-align:middle;box-sizing:border-box;` +
  'min-block-size:2.25em;padding-block:0;padding-inline:.75em .5em;' +
  `border-style:solid;border-width:max(.0625em,1px);border-color:${BORDER};border-radius:${RADIUS};` +
  `background:${SURFACE};color:${FG};transition:border-color .15s,outline-color .15s}` +
  `${box('[data-vera-input-host="sm"]')}{font-size:.875em}` +
  `${box('[data-vera-input-host="lg"]')}{font-size:1.125em}` +
  `${inner}{flex:1;min-inline-size:0;margin:0;padding:.5em 0;border:0;background:transparent;color:inherit;font:inherit;outline:0}` +
  `${box()} ${served('')}::placeholder{color:${FG_MUTED};opacity:1}` +
  `${box(':focus-within')}{outline:2px solid ${FOCUS};outline-offset:2px}` +
  `${boxWhen(':is(input[aria-invalid="true"],input:user-invalid)')}{border-color:${DANGER}}` +
  `${boxWhen('input:disabled')}{opacity:.5;cursor:not-allowed}` +
  `${inner}[type="number"]{appearance:textfield}` +
  `${inner}[type="number"]::-webkit-inner-spin-button{-webkit-appearance:none;appearance:none;margin:0}` +
  `${inner}[type="number"]::-webkit-outer-spin-button{-webkit-appearance:none;appearance:none;margin:0}` +
  `@media (prefers-reduced-motion:reduce){${box()}{transition:none}}` +
  `@media (forced-colors:active){${box(':focus-within')}{outline-color:Highlight}}`;

export const LOOK =
  BOX +
  `${part('clear', ':not([hidden])')},${part('reveal', ':not([hidden])')}{${BUTTON}}` +
  `${part('clear')}::before{content:"\\00d7" / ""}` +
  `${part('reveal')}::before{content:"\\25cf" / ""}` +
  `${part('reveal', '[aria-pressed="true"]')}::before{content:"\\25cb" / ""}` +
  `${part('clear')}:focus-visible,${part('reveal')}:focus-visible{outline:2px solid ${FOCUS};outline-offset:1px}` +
  `${part('loading', ':not([hidden])')}{display:inline-block;box-sizing:border-box;inline-size:1em;block-size:1em;` +
  'border:.125em solid color-mix(in srgb,currentColor 25%,transparent);border-block-start-color:currentColor;' +
  'border-radius:50%;animation:vera-input-turn .8s linear infinite}' +
  `${part('stepper')}{display:contents}` +
  `${stepPart('step-down')},${stepPart('step-up')}{display:block;flex:none;box-sizing:border-box;` +
  `inline-size:1.5em;block-size:1.5em;border-radius:calc(${RADIUS} * .5);line-height:1;cursor:pointer;user-select:none;` +
  '-webkit-user-select:none;touch-action:none}' +
  `${stepPart('step-down')}:hover,${stepPart('step-up')}:hover{background-color:${HOVER}}` +
  `${stepPart('step-down')}{background:${BAR} center/.625em .125em no-repeat}` +
  `${stepPart('step-up')}{background:${BAR} center/.625em .125em no-repeat,${BAR} center/.125em .625em no-repeat}` +
  `${stepOff('step-down')},${stepOff('step-up')}{cursor:inherit;background-color:transparent}` +
  `${part('caps-lock', ':not([hidden])')}{display:inline-block;font-size:.875em}` +
  `${served('', ':has(~[data-vera-part="clear"][data-vera-input])')}::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}` +
  '@keyframes vera-input-turn{to{transform:rotate(1turn)}}' +
  '@keyframes vera-input-pulse{50%{opacity:.35}}' +
  `@media (prefers-reduced-motion:reduce){${part('loading')}{animation:vera-input-pulse 2s ease-in-out infinite}}` +
  `@media (forced-colors:active){${part('loading')}{forced-color-adjust:none;border-color:Canvas;border-block-start-color:CanvasText}}`;
