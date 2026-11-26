/**
 * **The looks of `<vera-checkbox>` and `<vera-switch>`: one sheet per tag**, so a page with only checkboxes adopts no
 * switch rule. Each is drawn on the author's own input (`appearance: none`) and keyed on the mark the element writes
 * onto it, never on the tag or on a bare `input`; every selector is `:where()`, so any rule of the page wins.
 *
 * **The hit area is the input's own box, at least 24 × 24 CSS px** (WCAG 2.2, 2.5.8): the visible box is drawn on the
 * padding box, and a transparent border makes up the rest (`max(…, 13px − half the visible size)`), so a small font
 * keeps a 24px target and a large one grows past it. 13px, not 12: Chromium 159 rounds a border width down to whole
 * pixels, so a 4.5px ring drew 4 and the target read 23px; a pixel more per side keeps it at 24 or above after the
 * rounding. The input takes the page's font size (an input does not inherit it: the UA's is 13.33px), so the box
 * scales with its label's text. The ring the focus outline would otherwise sit outside is taken back by a negative
 * `outline-offset` of the same width.
 *
 * **States come from the platform's own pseudo-classes** (`:checked`, `:indeterminate`, `:disabled`, `:focus-visible`),
 * so the look follows the input whatever changed it: a click, a script, a form reset, back/forward restore.
 *
 * **Glyphs are `currentColor` gradients** (a check as two diagonal strokes, the dash and the thumb as one shape each),
 * never generated text: text glyphs measured 10.6 ms per 200 on the input stepper. Forced colors erase a gradient
 * background, so there the input takes `forced-color-adjust: none` and every color is a system color: the box edge
 * `ButtonText`, the glyph `CanvasText`, the ring `Highlight`, disabled `GrayText`.
 */
import { ACCENT, ACCENT_FG, BORDER_CONTROL, FOCUS, HOVER, SURFACE } from '@verajs/shared-utils';

/** The adoption keys: one per tag, so each look is adopted once per root and only where its tag is used. */
export const CHECKBOX_SHEET = '_$veraCheckbox$';
export const SWITCH_SHEET = '_$veraSwitch$';

/** The served input, marked `mark`, unless it or the host's copy says `data-vera-look="none"`; `state` is a pseudo-class. */
const on = (mark: string, state = ''): string => `:where(input[${mark}]:not([data-vera-look="none"])${state})`;

/** A stroke from one corner of its own box to the other: `angle` picks the diagonal, `from`/`to` its thickness. */
const stroke = (angle: string, from: string, to: string): string =>
  `linear-gradient(${angle},transparent ${from},currentColor ${from} ${to},transparent ${to})`;

/** The ring of transparent border that grows a visible box of `size` to a 24px target: one side's width. */
const ring = (size: string): string => `max(.1875em,calc(13px - ${size} / 2))`;

const BOX = '1.125em';
const C = 'data-vera-checkbox';
/** The check: a short stroke down to the right, then a long one up to the right, meeting at the bottom. */
const CHECK =
  `${stroke('45deg', '35%', '65%')} .2em .5em/.3em .3em no-repeat,` + `${stroke('-45deg', '41%', '59%')} .44em .3em/.5em .5em no-repeat`;
const DASH = 'linear-gradient(currentColor,currentColor) center/.625em .125em no-repeat';

export const CHECKBOX_LOOK =
  `${on(C)}{appearance:none;font-size:inherit;box-sizing:content-box;inline-size:${BOX};block-size:${BOX};margin:0;vertical-align:middle;` +
  `border:${ring(BOX)} solid transparent;border-radius:calc(4px + ${ring(BOX)});background:${SURFACE} padding-box;` +
  `box-shadow:inset 0 0 0 1px ${BORDER_CONTROL};color:${ACCENT_FG};flex:none}` +
  `${on(C, ':hover:not(:disabled,:checked,:indeterminate)')}{background-color:${HOVER}}` +
  `${on(C, ':checked')}{background:${CHECK},${ACCENT} padding-box;box-shadow:none}` +
  `${on(C, ':indeterminate')}{background:${DASH},${ACCENT} padding-box;box-shadow:none}` +
  `${on(C, ':disabled')}{opacity:.5}` +
  `${on(C, ':focus-visible')}{outline:2px solid ${FOCUS};outline-offset:calc(2px - ${ring(BOX)})}` +
  `@media (forced-colors:active){` +
  `${on(C)}{forced-color-adjust:none;background-color:Canvas;box-shadow:inset 0 0 0 1px ButtonText;color:CanvasText}` +
  `${on(C, ':checked')},${on(C, ':indeterminate')}{background-color:Canvas;box-shadow:inset 0 0 0 1px ButtonText}` +
  `${on(C, ':disabled')}{opacity:1;box-shadow:inset 0 0 0 1px GrayText;color:GrayText}` +
  `${on(C, ':focus-visible')}{outline-color:Highlight}}`;

const TRACK_W = '2.25em';
const TRACK_H = '1.25em';
const THUMB = '.875em';
const S = 'data-vera-switch';
/** The thumb: a disc in `currentColor`, at the track's inline start; checked, at its end. Mirrored under rtl. */
const DISC = `radial-gradient(circle closest-side,currentColor 92%,transparent) no-repeat`;
const START = `.1875em center/${THUMB} ${THUMB}`;
const END = `calc(100% - .1875em) center/${THUMB} ${THUMB}`;

export const SWITCH_LOOK =
  `${on(S)}{appearance:none;font-size:inherit;box-sizing:content-box;inline-size:${TRACK_W};block-size:${TRACK_H};margin:0;vertical-align:middle;` +
  `border:${ring(TRACK_H)} solid transparent;border-radius:999px;background:${DISC} ${START},${BORDER_CONTROL} padding-box;` +
  `color:${SURFACE};transition:background-position .15s,background-color .15s;flex:none}` +
  `${on(S, ':dir(rtl)')}{background-position:${END.split('/')[0]}}` +
  `${on(S, ':checked')}{background:${DISC} ${END},${ACCENT} padding-box;color:${ACCENT_FG}}` +
  `${on(S, ':checked:dir(rtl)')}{background-position:${START.split('/')[0]}}` +
  `${on(S, ':disabled')}{opacity:.5}` +
  `${on(S, ':focus-visible')}{outline:2px solid ${FOCUS};outline-offset:calc(2px - ${ring(TRACK_H)})}` +
  `@media (prefers-reduced-motion:reduce){${on(S)}{transition:none}}` +
  `@media (forced-colors:active){` +
  `${on(S)}{forced-color-adjust:none;background-color:Canvas;box-shadow:inset 0 0 0 1px ButtonText;color:ButtonText}` +
  `${on(S, ':checked')}{background-color:Highlight;box-shadow:none;color:HighlightText}` +
  `${on(S, ':disabled')}{opacity:1;box-shadow:inset 0 0 0 1px GrayText;color:GrayText}` +
  `${on(S, ':focus-visible')}{outline-color:Highlight}}`;
