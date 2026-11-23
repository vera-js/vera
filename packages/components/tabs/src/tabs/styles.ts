/**
 * **`<vera-tabs>`'s sheet**, adopted by the element into its root (kbd's way: `adoptOwnSheet`). Every rule is keyed on
 * our mark on the author's own nodes (`[data-vera-part="tablist"][data-vera-tabs]`, the tabs inside it), never a tag,
 * and is zero specificity, so a page's own rule wins; `data-vera-look="none"` on the host drops the look and keeps the
 * structure (only the hidden panels, which `hidden` itself handles).
 *
 * **The indicator is the tablist container's own `::after`**, anchored to the selected tab. The element sets one
 * per-instance anchor name inline on the container as `--_vera-tabs-anchor` (a shared name is document-wide in light
 * DOM, so every indicator would follow the last tablist's tab); a rule here gives that name to the
 * `[aria-selected="true"]` tab and the pseudo-element anchors to it, so the anchor follows the selection with no write
 * per tab (the element's own anchor writes cost about 4% of a set's creation, measured on Chromium). It lives inside the scrolling
 * container, so it scrolls with the tabs; it writes no node into the author's container. An author's own `::after` on
 * that container wins (zero specificity), and then our indicator is not drawn: the README says so. Without anchor
 * positioning the selected tab draws its own underline and nothing slides. Reduced motion: no slide. Forced colors: the
 * indicator is `Highlight`, and the selected tab is also bold.
 */
export const SHEET = '_$veraTabs$';

const look = (selector: string): string => `:where([data-vera-tabs]:not([data-vera-look="none"])) ${selector}`;
const LIST = ':where([data-vera-part="tablist"][data-vera-tabs])';
const TAB = `${LIST} > :where([role="tab"])`;

export const LOOK =
  `${look(LIST)}{position:relative;display:flex;gap:2px;overflow-x:auto;scrollbar-width:thin;` +
  'border-block-end:1px solid var(--vera-border,#d4d4d8)}' +
  `${look(`${LIST}[aria-orientation="vertical"]`)}{flex-direction:column;overflow-x:visible;border-block-end:0;border-inline-end:1px solid var(--vera-border,#d4d4d8)}` +
  `${look(TAB)}{flex:none;padding:8px 12px;border:0;background:none;color:var(--vera-fg-muted,#71717a);font:inherit;cursor:pointer;white-space:nowrap}` +
  `${look(`${TAB}[aria-selected="true"]`)}{color:var(--vera-fg,#18181b)}` +
  `${look(`${TAB}:disabled`)},${look(`${TAB}[aria-disabled="true"]`)}{opacity:.5;cursor:default}` +
  `${look(`${TAB}:focus-visible`)}{outline:2px solid var(--vera-accent,#7c3aed);outline-offset:-2px;border-radius:var(--vera-radius,6px)}` +
  '@supports (top: anchor(bottom)){' +
  `${look(`${TAB}[aria-selected="true"]`)}{anchor-name:var(--_vera-tabs-anchor)}` +
  `${look(`${LIST}::after`)}{content:"";position:absolute;position-anchor:var(--_vera-tabs-anchor);` +
  'left:anchor(left);width:anchor-size(width);top:calc(anchor(bottom) - 2px);height:2px;background:var(--vera-accent,#7c3aed);pointer-events:none}' +
  `${look(`${LIST}[aria-orientation="vertical"]::after`)}{left:calc(anchor(right) - 2px);width:2px;top:anchor(top);height:anchor-size(height)}` +
  '@media (prefers-reduced-motion:no-preference){' +
  `${look(`${LIST}::after`)}{transition:left 160ms ease,width 160ms ease,top 160ms ease,height 160ms ease}}}` +
  '@supports not (top: anchor(bottom)){' +
  `${look(`${TAB}[aria-selected="true"]`)}{box-shadow:inset 0 -2px 0 var(--vera-accent,#7c3aed)}}` +
  '@media (forced-colors:active){' +
  `${look(`${LIST}::after`)}{background:Highlight}` +
  `${look(`${TAB}[aria-selected="true"]`)}{font-weight:bold}}`;
