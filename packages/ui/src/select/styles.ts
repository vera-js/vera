/**
 * The select's stylesheet. Three disciplines, each load-bearing:
 *
 * - **Every color, radius and focus value is a `--vera-*` token with a real fallback**, so the
 *   component looks finished with no setup and adopts a theme by variable redefinition — custom
 *   properties inherit through shadow boundaries, so one `:root` block themes every component.
 *   Semantic names only (`--vera-surface`, never a palette-literal): dark mode is a token
 *   redefinition, not a second stylesheet.
 *
 * - **Selectors are wrapped in `:where()`**, holding them at zero specificity. In light mode this
 *   sheet is hoisted to the document, where adopted sheets sort *after* the page's own — without
 *   `:where()`, our rules would beat a user's equal-specificity override by order alone. At zero,
 *   any selector they write wins. (Shadow mode never needed the help — an outer `::part()` rule
 *   beats an inner rule by tree order — so one spelling serves both.)
 *
 * - **Visibility is expressed only as `[data-state]` rules, never inline styles**, so a consumer
 *   overriding `display` never fights style-attribute specificity.
 *
 * Selectors target `[part="…"]` directly: the part attribute doubles as the light-DOM styling
 * hook, so there is one name per node, not a part name and a class name to keep in lockstep.
 */
/**
 * IN-SHEET COMMENTARY, RELOCATED — a comment inside a template literal is STRING DATA to
 * the minifier and ships in every bundle (measured; the reclaim is in the commit). The
 * notes below annotate the sheet in source order; the sheet itself stays prose-free.
 *
 * Both states spell the full function list so the transition interpolates per function:
 * scaleY runs 1 -> -1 (the chevron flattens through zero and inverts — a mirror flip, not a
 * rotation) while the rotate stays constant. Mismatched lists would fall back to matrix
 * decomposition and animate something else entirely.
 *
 * Capped, deliberately, while the trigger takes the raw token: --vera-radius: 999px is a
 * legitimate pill trigger, but on a box this tall the same value plus overflow:hidden turns
 * the menu into a lens that clips its own rows. Found by the first demo page.
 *
 * Open/close animates the way the renderer README's recipe prescribes: display stays constant
 * (Firefox ignores allow-discrete on display while reporting support — pinned in
 * tests/browser/animation-recipes.test.js), and the closed state rides opacity + translate,
 * with visibility carrying the interaction/a11y removal — it flips discretely at the
 * transition's end, so the menu is untabbable and unread the moment it finishes leaving.
 * position:absolute means the always-rendered box costs no layout.
 *
 * THE ANCHOR TIER (SELECT-V2 §4): where the engine has CSS anchor positioning, the menu is a
 * top-layer popover anchored to the trigger — killing the overflow-clipping bug class — with
 * flip-when-clipped via position-try-fallbacks where supported (ignored elsewhere; those
 * engines keep today's non-flipping behavior, which is what they have now). Everything below
 * this block is the everywhere-fallback: it is not a second implementation, it is the current
 * one, kept. The popover attribute itself is applied by the element only on this tier — a
 * popover attribute on a non-anchor engine would UA-hide the menu display:none.
 * 
 * The open transition needs @starting-style (a popover enters from display:none); the CLOSE
 * transition needs none of allow-discrete's cross-engine grief: the element flips to
 * data-state=closed while still popover-open, today's opacity/translate transition plays, and
 * the element hides the popover after it settles.
 *
 * Leading underscore: the private-custom-property convention — internal plumbing, not a theme token (the surface drift test enforces the difference).
 *
 * The popover UA stylesheet adds 0.25em padding; and anchor-size() must land border-box
 *  or the menu runs 10px proud of the trigger it is matching.
 *
 * Scroll stays inside the menu instead of chaining to the page — wp-omni's bounce-free
 *  default. The opt-out is one rule: ::part(list) { overscroll-behavior: auto }.
 *
 * Screen-reader-only: the results/loading announcement.
 *
 * The checkmark lives on every row so selection can ANIMATE: content changes cannot transition,
 * but a box can grow. Collapsed it is zero-width and scale(0), with a negative end margin
 * swallowing the row's gap so unselected labels sit flush; selected it grows to size and the
 * margin releases, sliding the label over as the mark scales up.
 */
export const SELECT_STYLES = /* css */ `
  :host {
    display: block;
    position: relative;
  }
  :where(:scope) {
    display: block;
    position: relative;
  }

  :where([part='trigger']) {
    display: flex;
    align-items: center;
    gap: 6px;
    inline-size: 100%;
    min-block-size: 30px;
    padding: 4px 28px 4px 9px;
    box-sizing: border-box;
    border: 1px solid var(--vera-border, #d4d4d8);
    border-radius: var(--vera-radius, 6px);
    background: var(--vera-surface, #fff);
    color: var(--vera-fg, #18181b);
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  :where([part='trigger'][aria-disabled='true']) {
    opacity: 0.55;
    cursor: default;
  }
  :where([part='trigger']):focus-visible {
    outline: 2px solid var(--vera-focus, #7c3aed66);
    outline-offset: 1px;
  }
  :where([part='trigger'])::after {
    content: '';
    position: absolute;
    inset-inline-end: 10px;
    inset-block-start: 50%;
    inline-size: 7px;
    block-size: 7px;
    border-inline-end: 1.5px solid var(--vera-fg-muted, #71717a);
    border-block-end: 1.5px solid var(--vera-fg-muted, #71717a);
    transform: translateY(-70%) scaleY(1) rotate(45deg);
    pointer-events: none;
  }
  :where([part='trigger'][data-state='open'])::after {
    transform: translateY(-30%) scaleY(-1) rotate(45deg);
  }
  :where([part='value']) {
    display: inline-flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    min-block-size: 1lh;
  }
  :where([part='pill']) {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 4px 1px 8px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--vera-accent, #7c3aed) 14%, transparent);
    font-size: 0.92em;
  }
  :where([part='pill-remove']) {
    display: grid;
    place-items: center;
    inline-size: 16px;
    block-size: 16px;
    border: 0;
    border-radius: 999px;
    padding: 0;
    background: transparent;
    color: inherit;
    font-size: 10px;
    cursor: pointer;
  }
  :where([part='pill-remove']):hover {
    background: color-mix(in srgb, var(--vera-accent, #7c3aed) 25%, transparent);
  }
  :where([part='value']:empty)::before {
    content: attr(data-placeholder);
    color: var(--vera-fg-muted, #71717a);
  }

  :where([part='menu']) {
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(100% + 4px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    max-block-size: 260px;
    border: 1px solid var(--vera-border, #d4d4d8);
    border-radius: min(var(--vera-radius, 6px), 14px);
    background: var(--vera-surface, #fff);
    box-shadow: 0 8px 24px color-mix(in srgb, #000 18%, transparent);
    overflow: hidden;
  }
  :where([part='menu'][data-state='closed']) {
    opacity: 0;
    translate: 0 -6px;
    visibility: hidden;
    pointer-events: none;
  }
  /*
   * The squeeze rung makes the menu viewport-aware in SIZE, not just position: below at natural
   * size, flipped above at natural size, and only when NEITHER side holds the menu whole does it
   * shrink into the below-area (position-area makes the containing block the region under the
   * anchor, so the 100% cap IS the available space) and scroll internally - measured identical
   * on stable Chrome, Playwright Chromium, Firefox and WebKit, 4 geometries each. @position-try
   * rungs carrying INSET PAIRS are inert on all four engines (probed, twice) - position-area is
   * the shape that participates. Nested @supports: an engine with anchor() but no position-area
   * keeps plain flip.
   */
  @supports (top: anchor(bottom)) {
    :where([part='trigger']) {
      anchor-name: --_vera-select-anchor;
    }
    :where([part='menu'][popover]) {
      position: fixed;
      position-anchor: --_vera-select-anchor;
      inset: auto;
      padding: 0;
      box-sizing: border-box;
      top: calc(anchor(bottom) + 4px);
      left: anchor(left);
      inline-size: anchor-size(width);
      margin: 0;
      position-try-fallbacks: flip-block;
    }
    :where([part='menu'][popover]:popover-open) {
      @starting-style {
        opacity: 0;
        translate: 0 -6px;
      }
    }
    @supports (position-area: block-end) {
      :where([part='menu'][popover]) {
        position-try-fallbacks: flip-block, --_vera-select-squeeze;
      }
      @position-try --_vera-select-squeeze {
        inset: auto;
        position-area: block-end span-inline-end;
        max-block-size: calc(100% - 12px);
        margin-block: 4px;
      }
    }
  }

  /*
   * The visibility transition is DIRECTION-SPLIT on purpose (transition-property reads from the
   * destination state): closing holds visibility for the fade; opening flips it instantly,
   * because a transitioning visibility left the menu computed-hidden for a window after open and
   * a real engine REFUSES focus() into hidden content - the search line's auto-focus silently
   * failed on first open (Chromium; jsdom focuses anything, so only a browser shows it).
   */
  @media (prefers-reduced-motion: no-preference) {
    :where([part='menu']) {
      transition:
        opacity 140ms ease,
        translate 140ms ease;
    }
    :where([part='menu'][data-state='closed']) {
      transition:
        opacity 140ms ease,
        translate 140ms ease,
        visibility 140ms;
    }
    :where([part='trigger'])::after {
      transition: transform 140ms ease;
    }
    :where([part='option'])::before {
      transition:
        scale 140ms ease,
        inline-size 140ms ease,
        margin-inline-end 140ms ease;
    }
  }
  :where([part='search']) {
    padding: 7px 9px;
    border: 0;
    border-block-end: 1px solid var(--vera-border, #d4d4d8);
    background: transparent;
    color: inherit;
    font: inherit;
    outline: none;
  }
  :where([part='list']) {
    margin: 0;
    padding: 3px;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  :where([part='option']) {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: min(calc(var(--vera-radius, 6px) - 2px), 8px);
    cursor: pointer;
  }
  :where([part='option-icon']) {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: var(--vera-fg-muted, #71717a);
  }
  :where([part='option-label']) {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  :where([part='option-description']) {
    font-size: 0.85em;
    color: var(--vera-fg-muted, #71717a);
  }
  :where([part='group']) {
    display: contents;
  }
  :where([part='group-label']) {
    display: block;
    padding: 6px 8px 2px;
    font-size: 0.78em;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: var(--vera-fg-muted, #71717a);
  }
  :where([part='status']) {
    position: absolute;
    inline-size: 1px;
    block-size: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
  :where([part='option'][data-active]) {
    background: color-mix(in srgb, var(--vera-accent, #7c3aed) 16%, transparent);
  }
  :where([part='option'][aria-disabled='true']) {
    opacity: 0.45;
    cursor: default;
  }
  :where([part='option'])::before {
    content: '✓';
    inline-size: 0;
    margin-inline-end: -7px;
    scale: 0;
    color: var(--vera-accent, #7c3aed);
  }
  :where([part='option'][aria-selected='true'])::before {
    inline-size: 14px;
    margin-inline-end: 0;
    scale: 1;
  }
  :where([part='option'][data-create])::before {
    content: none;
  }
  :where([part='option'][data-create]) {
    color: var(--vera-accent, #7c3aed);
  }
  :where([part='empty']) {
    margin: 0;
    padding: 8px 10px;
    color: var(--vera-fg-muted, #71717a);
  }
  :where([part='empty'][data-state='hidden']) {
    display: none;
  }
  :where([part='overflow']) {
    margin: 0;
    padding: 6px 10px;
    border-block-start: 1px solid var(--vera-border, #d4d4d8);
    color: var(--vera-fg-muted, #71717a);
    font-size: 0.85em;
  }
  :where([part='overflow'][data-state='hidden']) {
    display: none;
  }
`;
