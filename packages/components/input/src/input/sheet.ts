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
 * - **Scale** sets the served input's own font size (an `<input>` does not inherit it): `md` the page's (1em), `sm` and
 *   `lg` around it, so the three are ordered whatever the page's size; no `scale` leaves the browser's own. The buttons
 *   and marks are sized in `em`, so they follow the host's.
 * - **One clear glyph:** while our clear button sits beside a search input, the engine's own cancel button is hidden
 *   (Chromium and WebKit draw one). All three engines keep the rule, Firefox 159 included (measured); it is a rule of
 *   its own, so an engine that ever drops the pseudo-element loses only that rule.
 * - **Reduced motion** keeps "busy" visible (a slow pulse, never nothing); **forced colors** keep the loading mark's
 *   two system colors, so it is still seen to move.
 */

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

const BUTTON =
  'display:inline-grid;place-items:center;box-sizing:border-box;inline-size:1.5em;block-size:1.5em;margin:0;padding:0;' +
  'border:0;border-radius:var(--vera-radius,.25em);background:transparent;color:inherit;font:inherit;line-height:1;cursor:pointer';

export const LOOK =
  `${part('clear', ':not([hidden])')},${part('reveal', ':not([hidden])')}{${BUTTON}}` +
  `${part('clear')}::before{content:"\\00d7" / ""}` +
  `${part('reveal')}::before{content:"\\25cf" / ""}` +
  `${part('reveal', '[aria-pressed="true"]')}::before{content:"\\25cb" / ""}` +
  `${part('clear')}:focus-visible,${part('reveal')}:focus-visible{outline:2px solid var(--vera-focus,Highlight);outline-offset:1px}` +
  `${part('loading', ':not([hidden])')}{display:inline-block;box-sizing:border-box;inline-size:1em;block-size:1em;` +
  'border:.125em solid color-mix(in srgb,currentColor 25%,transparent);border-block-start-color:currentColor;' +
  'border-radius:50%;animation:vera-input-turn .8s linear infinite}' +
  `${part('caps-lock', ':not([hidden])')}{display:inline-block;font-size:.875em}` +
  `${served('="md"')}{font-size:1em}${served('="sm"')}{font-size:.875em}${served('="lg"')}{font-size:1.125em}` +
  `${served('', ':has(~[data-vera-part="clear"][data-vera-input])')}::-webkit-search-cancel-button{-webkit-appearance:none;appearance:none}` +
  '@keyframes vera-input-turn{to{transform:rotate(1turn)}}' +
  '@keyframes vera-input-pulse{50%{opacity:.35}}' +
  `@media (prefers-reduced-motion:reduce){${part('loading')}{animation:vera-input-pulse 2s ease-in-out infinite}}` +
  `@media (forced-colors:active){${part('loading')}{forced-color-adjust:none;border-color:Canvas;border-block-start-color:CanvasText}}`;
