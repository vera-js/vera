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
    transform: translateY(-70%) rotate(45deg);
    pointer-events: none;
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
    /**
     * Capped, deliberately, while the trigger takes the raw token: --vera-radius: 999px is a
     * legitimate pill trigger, but on a box this tall the same value plus overflow:hidden turns
     * the menu into a lens that clips its own rows. Found by the first demo page.
     */
    border-radius: min(var(--vera-radius, 6px), 14px);
    background: var(--vera-surface, #fff);
    box-shadow: 0 8px 24px color-mix(in srgb, #000 18%, transparent);
    overflow: hidden;
  }
  :where([part='menu'][data-state='closed']) {
    display: none;
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
  }
  :where([part='option']) {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 8px;
    border-radius: min(calc(var(--vera-radius, 6px) - 2px), 8px);
    cursor: pointer;
  }
  :where([part='option'][data-active]) {
    background: color-mix(in srgb, var(--vera-accent, #7c3aed) 16%, transparent);
  }
  :where([part='option'][aria-disabled='true']) {
    opacity: 0.45;
    cursor: default;
  }
  :where([part='option'][aria-selected='true'])::before {
    content: '✓';
    inline-size: 14px;
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
`;
