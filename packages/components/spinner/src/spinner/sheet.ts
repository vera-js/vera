/**
 * **The arc's rules, from one source**: the rule the element adopts into the root it renders in (`adoptOwnSheet`, and
 * a server's `styles`), and the `preupgrade.css` a page links so an empty `<vera-spinner>` turns before its script
 * runs (written into `dist/` by the build from {@link PREUPGRADE}, never committed, so the two cannot drift).
 *
 * - **Keyed on our own part attribute and our own mark, never the tag**, so `defineAs('my-spinner')` draws the same
 *   arc (kbd's rule keyed on its tag matched nothing under a tag of the caller's own). Part names are a vocabulary
 *   every component shares, so a rule keyed on `[data-vera-part="label"]` alone would style another component's
 *   label part too (a browser row): each part also carries `data-vera-spinner`, and every rule asks for both. The pre-upgrade rule is the one exception: an
 *   element awaiting its definition has no part yet, so it can only be found by its tag (the default one).
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
const ARC_PART = ':where(:not([data-vera-look="none"])>[data-vera-part="arc"][data-vera-spinner]:not([data-vera-look="none"]))';
const LABEL_PART = ':where(:not([data-vera-look="none"])>[data-vera-part="label"][data-vera-spinner])';
/**
 * Before upgrade: the default tag's empty host draws the ring as generated content. `:empty`, so server markup (whose
 * arc part is already drawn by the server's rule) never gets a second ring.
 */
const WAITING = ':where(vera-spinner:not(:defined):empty:not([data-vera-look="none"]))::before';

/** The ring, the turn, and the reduced-motion and forced-colors branches, for one selector. */
const ring = (selector: string): string =>
  `${selector}{display:inline-block;box-sizing:border-box;inline-size:var(--vera-spinner-size,1em);block-size:var(--vera-spinner-size,1em);` +
  'border:var(--vera-spinner-width,.125em) solid var(--vera-spinner-track,color-mix(in srgb,currentColor 25%,transparent));' +
  'border-block-start-color:var(--vera-spinner-color,currentColor);border-radius:50%;vertical-align:-.125em;' +
  'animation:vera-spinner-turn .8s linear infinite}' +
  `@media (prefers-reduced-motion:reduce){${selector}{animation:vera-spinner-pulse 2s ease-in-out infinite}}` +
  `@media (forced-colors:active){${selector}{forced-color-adjust:none;border-color:Canvas;border-block-start-color:CanvasText}}`;

const KEYFRAMES = '@keyframes vera-spinner-turn{to{transform:rotate(1turn)}}@keyframes vera-spinner-pulse{50%{opacity:.35}}';

/** The rule the element adopts (and a server returns): the arc part and the shown label. */
export const ARC = ring(ARC_PART) + `${LABEL_PART}{margin-inline-start:.5em}` + KEYFRAMES;

/** `dist/preupgrade.css`: an empty, not yet defined spinner turns, in `@layer vera` so a page's own CSS wins. */
export const PREUPGRADE = `@layer vera{${ring(WAITING).replace('{display:inline-block;', '{content:"";display:inline-block;')}${KEYFRAMES}}`;
