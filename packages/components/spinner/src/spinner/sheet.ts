/**
 * **The arc's one rule**, adopted by the element into the root it renders in (`adoptOwnSheet`).
 *
 * - **Keyed on our own part attribute, never the tag**, so `defineAs('my-spinner')` draws the same arc (kbd's rule
 *   keyed on its tag matched nothing under a tag of the caller's own).
 * - **Zero specificity** (`:where`), so any rule a page writes wins.
 * - **`data-vera-look="none"`** on the host or on the arc drops the look; the part stays.
 * - **Compositor only:** the turn animates `transform`, the reduced-motion pulse `opacity`; neither lays out.
 * - **Reduced motion keeps "busy" visible**: the turn becomes a slow pulse, never nothing.
 * - **Forced colors:** the system would paint the track and the turning segment one color, so nothing would be seen to
 *   move; the arc keeps its own two system colors there instead.
 * - Sized by the font (1em) unless `--vera-spinner-size` says otherwise, so it fits beside text and inside a button.
 */

/** The root's key for the arc's rule (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
export const SHEET = '_$veraSpinnerArc$';

/** The parts the rule styles, unless the host or the part opted out of the look. */
const ARC_PART = ':where(:not([data-vera-look="none"])>[data-vera-part="arc"]:not([data-vera-look="none"]))';
const LABEL_PART = ':where(:not([data-vera-look="none"])>[data-vera-part="label"])';

export const ARC =
  `${ARC_PART}{display:inline-block;box-sizing:border-box;inline-size:var(--vera-spinner-size,1em);block-size:var(--vera-spinner-size,1em);` +
  'border:var(--vera-spinner-width,.125em) solid var(--vera-spinner-track,color-mix(in srgb,currentColor 25%,transparent));' +
  'border-block-start-color:var(--vera-spinner-color,currentColor);border-radius:50%;vertical-align:-.125em;' +
  'animation:vera-spinner-turn .8s linear infinite}' +
  `${LABEL_PART}{margin-inline-start:.5em}` +
  '@keyframes vera-spinner-turn{to{transform:rotate(1turn)}}' +
  '@keyframes vera-spinner-pulse{50%{opacity:.35}}' +
  `@media (prefers-reduced-motion:reduce){${ARC_PART}{animation:vera-spinner-pulse 2s ease-in-out infinite}}` +
  `@media (forced-colors:active){${ARC_PART}{forced-color-adjust:none;border-color:Canvas;border-block-start-color:CanvasText}}`;
