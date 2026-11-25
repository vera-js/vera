/**
 * **The shared look's tokens, one constant each: the `var(--vera-<name>, <default>)` a component's sheet writes.** Every
 * component reads the same thirteen custom properties with the same defaults, so a page with one component looks
 * finished and matches a page with all of them, and an app restyles every component by setting a few of them (the
 * accent, the radius, the surface) on `:root`.
 *
 * A naming contract, not a runtime: components are independent bundles, and each inlines only the constants its sheet
 * uses (each is a string constant the minifier folds into the sheet; a record plus a helper would carry every token
 * into every bundle). `tests/component-tokens.test.mjs` holds every sheet to these exact defaults.
 *
 * Colors default by `light-dark(<light>, <dark>)`: the page's `color-scheme` picks one (`:root { color-scheme: light
 * dark }` follows the system). With no `color-scheme` the light value is used, so a component is never invisible, only
 * light. The look's floor is therefore the engines with `light-dark()` (Chromium 123, Firefox 120, Safari 17.5): below
 * it a token with no value set is unset (Brian, 2026-11-25). Our hosts never set `color-scheme`: that is the app's.
 */

/** Page-level background a control sits on. */
export const BG = 'var(--vera-bg,light-dark(#fff,#0c0c10))';
/** Raised surfaces: lists, dialogs, inputs. */
export const SURFACE = 'var(--vera-surface,light-dark(#fff,#17171c))';
/** Text. */
export const FG = 'var(--vera-fg,light-dark(#0f0f14,#f2f2f5))';
/** Secondary text: placeholders, hints, idle tabs. */
export const FG_MUTED = 'var(--vera-fg-muted,light-dark(#5f5f6b,#a1a1aa))';
/** Hairlines: dividers, rules, a surface's edge. A control's own edge is BORDER_CONTROL. */
export const BORDER = 'var(--vera-border,light-dark(#e4e4ea,#2e2e37))';
/**
 * A control's own boundary (an input's box, a select's trigger): 3:1 against SURFACE and BG in both schemes, as WCAG
 * 1.4.11 asks of the edge that shows where a control is (#8a8a96 on #fff 3.41; #686874 on #17171c 3.25, on #0c0c10
 * 3.55). BORDER stays the quiet divider for surfaces and rules, which need no contrast (1.27/1.33).
 */
export const BORDER_CONTROL = 'var(--vera-border-control,light-dark(#8a8a96,#686874))';
/** Hover and active-option fill. */
export const HOVER = 'var(--vera-hover,light-dark(#f2f2f6,#202028))';
/** Selection, indicators, the primary action. */
export const ACCENT = 'var(--vera-accent,light-dark(oklch(.56 .22 280),oklch(.72 .16 280)))';
/** Text and icons on the accent. */
export const ACCENT_FG = 'var(--vera-accent-fg,light-dark(#fff,#0c0c10))';
/**
 * The focus ring's color: the accent itself, opaque, drawn as a 2px `outline` 2px outside the control, never a
 * box-shadow (forced colors drops a box-shadow and keeps an outline). Opaque because a ring must reach 3:1 against the
 * surface beside it (WCAG 2.4.13, 1.4.11): the accent at 60% read 1.93 in light, the opaque accent 5.05 in light and 6.86
 * in dark, computed on SURFACE. Follows the accent an app sets.
 */
export const FOCUS = `var(--vera-focus,${ACCENT})`;
/** Errors. */
export const DANGER = 'var(--vera-danger,light-dark(#c4321c,#ff7a66))';
/** Corners; a pill keeps its own 999px. */
export const RADIUS = 'var(--vera-radius,8px)';
/** Raised surfaces' shadow: two soft layers, deeper in the dark. */
export const SHADOW = 'var(--vera-shadow,0 1px 2px light-dark(rgb(0 0 0/.05),rgb(0 0 0/.4)),0 8px 24px -8px light-dark(rgb(0 0 0/.14),rgb(0 0 0/.6)))';
