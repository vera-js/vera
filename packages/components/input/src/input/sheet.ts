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

import { BORDER, DANGER, FG, FG_MUTED, FOCUS, RADIUS, SURFACE } from '@verajs/shared-utils';

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

/** The box while its served input matches `state` (`:focus-visible`, `:disabled`, …). */
const boxWhen = (state: string): string => box(`:has(input[data-vera-input]:not([data-vera-look="none"])${state})`);

const BUTTON =
  'display:inline-grid;place-items:center;box-sizing:border-box;inline-size:1.5em;block-size:1.5em;margin:0;padding:0;' +
  `border:0;border-radius:calc(${RADIUS} * .5);background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer`;

/**
 * The box's rules. Its font size is the scale (`md` the page's, `sm` and `lg` around it), and the input inherits it, so
 * the text, the box and the parts (sized in `em`) move together. The ring is the shared focus ring on the box while the
 * input inside shows focus; the input's own outline goes only by a rule that ALSO needs `:has()`, so an engine without
 * `:has()` (Firefox 120, under the look's floor by one release) drops both and keeps its native ring, never neither.
 * The border turns `--vera-danger` on a control marked `aria-invalid="true"` or one the user has left invalid
 * (`:user-invalid`, which matches only once the user has interacted); each its own rule, so an engine without
 * `:user-invalid` loses only that one. Inside `<vera-field>` the field sets the border token while it shows an error, so
 * this rule stays the one owner of the box's edge.
 */
const BOX =
  `${box(':not([hidden])')}{display:inline-flex;align-items:center;gap:.25em;vertical-align:middle;box-sizing:border-box;` +
  'min-block-size:2.25em;padding-block:0;padding-inline:.75em .5em;' +
  `border-style:solid;border-width:max(.0625em,1px);border-color:${BORDER};border-radius:${RADIUS};` +
  `background:${SURFACE};color:${FG};transition:border-color .15s,outline-color .15s}` +
  `${box('[data-vera-input-host="md"]')}{font-size:1em}${box('[data-vera-input-host="sm"]')}{font-size:.875em}` +
  `${box('[data-vera-input-host="lg"]')}{font-size:1.125em}` +
  `${box()} ${served('')}{flex:1;min-inline-size:0;margin:0;padding:.5em 0;border:0;background:transparent;color:inherit;font:inherit}` +
  `${box()} ${served('')}::placeholder{color:${FG_MUTED};opacity:1}` +
  `${box(':has(input[data-vera-input])')} ${served('')}{outline:0}` +
  `${boxWhen(':focus-visible')}{outline:2px solid ${FOCUS};outline-offset:2px}` +
  `${boxWhen('[aria-invalid="true"]')}{border-color:${DANGER}}` +
  `${boxWhen(':user-invalid')}{border-color:${DANGER}}` +
  `${boxWhen(':disabled')}{opacity:.5;cursor:not-allowed}` +
  `@media (prefers-reduced-motion:reduce){${box()}{transition:none}}` +
  `@media (forced-colors:active){${boxWhen(':focus-visible')}{outline-color:Highlight}}`;

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
  `${part('caps-lock', ':not([hidden])')}{display:inline-block;font-size:.875em}` +
  `${served('', ':has(~[data-vera-part="clear"][data-vera-input])')}::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}` +
  '@keyframes vera-input-turn{to{transform:rotate(1turn)}}' +
  '@keyframes vera-input-pulse{50%{opacity:.35}}' +
  `@media (prefers-reduced-motion:reduce){${part('loading')}{animation:vera-input-pulse 2s ease-in-out infinite}}` +
  `@media (forced-colors:active){${part('loading')}{forced-color-adjust:none;border-color:Canvas;border-block-start-color:CanvasText}}`;
