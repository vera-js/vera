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
import { ACCENT, BORDER, BORDER_CONTROL, DANGER, FG, FG_MUTED, FOCUS, RADIUS, SHADOW, SURFACE } from '@verajs/shared-utils';

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
 * top-layer popover anchored to the trigger — killing the overflow-clipping bug class — on the
 * side the element chose at the open (data-side). Everything below
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
 *
 * ROOT + SURFACE FOREGROUND: :host sets the base text color, but each surface (trigger, menu)
 * ALSO declares color: var(--vera-fg) — a :host color does not reach the menu as a top-layer
 * popover (own containing block), and did not reach the menu's content even outside it, so option
 * rows and the search input were left at the UA #000, invisible on a dark --vera-surface (1.21:1,
 * axe). Set at each surface, descendants inherit.
 *
 * THE SIZE CAP: viewport-aware SIZE, not just position — at natural size on the chosen side, and
 * when that side is short, shrunk into it and scrolled. position-area makes the containing block
 * the region on that side of the anchor, so the 100% cap IS the available space.
 *
 * VISIBILITY IS DIRECTION-SPLIT: the closed-state rule carries visibility in its transition (holds
 * the fade); the base does not (opening flips it instantly). A transitioning visibility left the
 * menu computed-hidden after open and a real engine REFUSES focus() into hidden content — the
 * search auto-focus silently failed on first open (jsdom focuses anything, so browser-only).
 *
 * THE CREATE ROW is the one place accent is BODY TEXT; highlighted, it sat on the accent tint at
 * 4.46:1 (under WCAG AA). --vera-accent-strong mixes accent 20% toward --vera-fg, moving the text
 * away from the surface in EITHER theme (light ~5.8:1, dark ~6.1:1); a plain darken regressed dark
 * mode to 3.7:1. Derived from two existing tokens, reusable by any accent-on-tint foreground.
 */
export const SELECT_STYLES = /* css */ `
  :host {
    display: block;
    position: relative;
    color: ${FG};
  }
  :where(:scope) {
    display: block;
    position: relative;
    color: ${FG};
  }

  :where([part='trigger']) {
    display: flex;
    align-items: center;
    gap: 6px;
    inline-size: 100%;
    /* Input's box height, so a select and an input side by side in a form line up. */
    min-block-size: 2.25em;
    padding: 4px 28px 4px 10px;
    box-sizing: border-box;
    border: 1px solid ${BORDER_CONTROL};
    border-radius: ${RADIUS};
    background: ${SURFACE};
    color: ${FG};
    font: inherit;
    text-align: start;
    cursor: pointer;
  }
  :where([part='trigger'][aria-disabled='true']) {
    opacity: 0.55;
    cursor: default;
  }
  /*
   * Invalid: a field that shows an error marks its control aria-invalid (@vera-hooks/labeled), here the host; the
   * trigger, the select's visible boundary, takes the danger color. Shadow mode reads the host, light mode the scope.
   */
  :host([aria-invalid='true']) :where([part='trigger']),
  :where(:scope[aria-invalid='true']) :where([part='trigger']) {
    border-color: ${DANGER};
  }
  :where([part='trigger']):focus-visible {
    outline: 2px solid ${FOCUS};
    outline-offset: 2px;
  }
  :where([part='trigger'])::after {
    content: '';
    position: absolute;
    inset-inline-end: 10px;
    inset-block-start: 50%;
    inline-size: 7px;
    block-size: 7px;
    border-inline-end: 1.5px solid ${FG_MUTED};
    border-block-end: 1.5px solid ${FG_MUTED};
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
    background: color-mix(in srgb, ${ACCENT} 14%, transparent);
    font-size: 0.92em;
  }
  :where([part='pill-icon']) {
    display: inline-flex;
    align-items: center;
    flex-shrink: 0;
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
    background: color-mix(in srgb, ${ACCENT} 25%, transparent);
  }
  /** \`clearable\`'s control: at the trigger's end, before the chevron's reserved space; the pill ✕'s look. */
  :where([part='clear']) {
    display: grid;
    place-items: center;
    flex-shrink: 0;
    margin-inline-start: auto;
    inline-size: 18px;
    block-size: 18px;
    border: 0;
    border-radius: 999px;
    padding: 0;
    background: transparent;
    color: ${FG_MUTED};
    font-size: 10px;
    cursor: pointer;
  }
  :where([part='clear']):hover {
    background: color-mix(in srgb, ${ACCENT} 25%, transparent);
    color: ${FG};
  }
  :where([part='value']:empty)::before {
    content: attr(data-placeholder);
    color: ${FG_MUTED};
  }

  :where([part='menu']) {
    position: absolute;
    inset-inline: 0;
    inset-block-start: calc(100% + 4px);
    z-index: 50;
    display: flex;
    flex-direction: column;
    /* Room for a group or two with descriptions before anything scrolls (Brian, 2026-11-25: short lists showed a scrollbar). */
    max-block-size: min(360px, 70vh);
    border: 1px solid ${BORDER};
    border-radius: min(${RADIUS}, 14px);
    background: ${SURFACE};
    color: ${FG};
    box-shadow: ${SHADOW};
    overflow: hidden;
  }
  :where([part='menu'][data-state='closed']) {
    opacity: 0;
    translate: 0 -6px;
    visibility: hidden;
    pointer-events: none;
  }
  /*
   * The anchor NAME is per instance — a private name built from the element's uid, set inline on
   * the trigger and the menu by the element. A shared name here is tree-scoped only inside a shadow
   * root: in the light DOM it is document-wide and the last trigger in tree order wins, so every
   * light dropdown's menu opened under the last one on the page.
   */
  @supports (top: anchor(bottom)) and (position-area: block-end) {
    :where([part='menu'][popover]) {
      position: fixed;
      inset: auto;
      padding: 0;
      box-sizing: border-box;
      /*
       * Below the trigger, from its inline start; above it when the element chose data-side="top" at the open. No
       * position-try fallback: flip-block opened the list ABOVE a trigger with room below on any scrolled page in
       * Chromium 159 and WebKit (Playwright, 2026-11-25), and an engine keeps a fallback it chose while it still fits.
       * The list's cap is the room on its side (under position-area, 100% is that region), so a long list scrolls
       * within the viewport instead of leaving it.
       */
      position-area: block-end span-inline-end;
      margin-block: 4px;
      max-block-size: min(360px, 70vh, calc(100% - 8px));
      /*
       * At least the trigger's width, wider when an option needs it, like a native select's list (a list only as wide
       * as a short trigger wrapped every description), and never past the viewport.
       */
      min-inline-size: anchor-size(width);
      inline-size: max-content;
      max-inline-size: min(28rem, calc(100vw - 16px));
      margin-inline: 0;
    }
    :where([part='menu'][popover][data-side='top']) {
      position-area: block-start span-inline-end;
    }
    :where([part='menu'][popover]:popover-open) {
      @starting-style {
        opacity: 0;
        translate: 0 -6px;
      }
    }
    /* Above the trigger the list slides in from below, toward the trigger, as it does from above when below it. */
    :where([part='menu'][popover][data-side='top'][data-state='closed']) {
      translate: 0 6px;
    }
    :where([part='menu'][popover][data-side='top']:popover-open) {
      @starting-style {
        translate: 0 6px;
      }
    }
  }

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
    border-block-end: 1px solid ${BORDER};
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
    border-radius: min(calc(${RADIUS} - 2px), 8px);
    cursor: pointer;
  }
  :where([part='option-icon']) {
    display: flex;
    align-items: center;
    flex-shrink: 0;
    color: ${FG_MUTED};
  }
  :where([part='option-label']) {
    display: flex;
    flex-direction: column;
    min-inline-size: 0;
  }
  :where([part='option-description']) {
    font-size: 0.85em;
    color: ${FG_MUTED};
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
    color: ${FG_MUTED};
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
    background: color-mix(in srgb, ${ACCENT} 16%, transparent);
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
    color: ${ACCENT};
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
    color: color-mix(in oklch, ${ACCENT}, ${FG} 20%);
  }
  :where([part='empty']) {
    margin: 0;
    padding: 8px 10px;
    color: ${FG_MUTED};
  }
  :where([part='empty'][data-state='hidden']) {
    display: none;
  }
  :where([part='overflow']) {
    margin: 0;
    padding: 6px 10px;
    border-block-start: 1px solid ${BORDER};
    color: ${FG_MUTED};
    font-size: 0.85em;
  }
  :where([part='overflow'][data-state='hidden']) {
    display: none;
  }
`;
