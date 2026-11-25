/**
 * **`<vera-menu>`'s sheet**, adopted by the element into its root (`adoptOwnSheet`, tabs' and kbd's way). Every rule is
 * keyed on our mark on the author's own container (`[data-vera-part="menu"][data-vera-menu]`) and is zero specificity,
 * so a page's own rule wins; `data-vera-look="none"` on the host drops the look and keeps the placement.
 *
 * **Placement is CSS only.** The container is a popover in the top layer, anchored by a per-instance anchor name the
 * element writes on the trigger (or on its one 0×0 point node in context mode) and hands over in `--_vera-menu-anchor`:
 * under the trigger at its inline start, flipping to the other block or inline side when it does not fit, its block size
 * clamped to the viewport and scrolling. Where an engine lacks anchor positioning the popover keeps the platform's own
 * centered placement. Entry and exit fade under `prefers-reduced-motion: no-preference` (`@starting-style`; the exit is
 * instant where `display` cannot transition). The item under the pointer and the focused item fill with the hover token, the
 * fill fading in over 120ms under the same media query. Forced colors: the focused item is `Highlight`.
 */
import { BORDER, FG, FG_MUTED, HOVER, RADIUS, SHADOW, SURFACE } from '@verajs/shared-utils';

export const SHEET = '_$veraMenu$';

const MENU = ':where([data-vera-part="menu"][data-vera-menu])';
const look = (selector: string): string => `:where([data-vera-menu]:not([data-vera-look="none"])) ${selector}`;
const ITEM = `${MENU} :where([role^="menuitem"])`;

export const PLACE =
  '@supports (position-anchor:--a){' +
  `${MENU}{position:fixed;inset:auto;margin:4px 0;position-anchor:var(--_vera-menu-anchor);` +
  'position-area:block-end span-inline-end;position-try-fallbacks:flip-block,flip-inline,flip-block flip-inline;' +
  'max-block-size:calc(100dvh - 16px);overflow-y:auto}}';

export const LOOK =
  PLACE +
  `${look(MENU)}{min-inline-size:10rem;padding:4px;border:1px solid ${BORDER};border-radius:${RADIUS};` +
  `background:${SURFACE};color:${FG};box-shadow:${SHADOW};font:inherit}` +
  `${look(MENU)}:focus{outline:none}` +
  `${look(ITEM)}{display:flex;align-items:center;gap:8px;inline-size:100%;box-sizing:border-box;padding:6px 8px;border:0;` +
  `border-radius:calc(${RADIUS} - 4px);background:none;color:inherit;font:inherit;text-align:start;text-decoration:none;cursor:default}` +
  `${look(`${ITEM}:focus`)}{outline:none;background:${HOVER}}` +
  /** The pointer's item fills too: a hover does not move focus, so without it a mouse got no answer. */
  `${look(`${ITEM}:hover:not(:disabled,[aria-disabled="true"])`)}{background:${HOVER}}` +
  `${look(`${ITEM}:is(:disabled,[aria-disabled="true"])`)}{opacity:.5}` +
  `${look(`${ITEM} :where(kbd,vera-kbd)`)}{margin-inline-start:auto;color:${FG_MUTED};font-size:.85em}` +
  `${look(`${ITEM}[aria-checked]::before`)}{content:"";inline-size:1em;text-align:center}` +
  `${look(`${ITEM}[aria-checked="true"]::before`)}{content:"\\2713"}` +
  `${look(`${ITEM}[role="menuitemradio"][aria-checked="true"]::before`)}{content:"\\2022"}` +
  `${look(`${MENU} :where(hr)`)}{margin:4px 0;border:0;border-block-start:1px solid ${BORDER}}` +
  '@media (prefers-reduced-motion:no-preference){' +
  `${look(MENU)}{transition:opacity 120ms ease,display 120ms allow-discrete,overlay 120ms allow-discrete}` +
  `${look(ITEM)}{transition:background-color 120ms ease}` +
  `${look(`${MENU}:not(:popover-open)`)}{opacity:0}` +
  `@starting-style{${look(`${MENU}:popover-open`)}{opacity:0}}}` +
  '@media (forced-colors:active){' +
  `${look(`${ITEM}:focus`)}{background:Highlight;color:HighlightText}}`;
