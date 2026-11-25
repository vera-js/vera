/**
 * **<vera-field>'s look, one rule set**, adopted by the element into the root it renders in (`adoptOwnSheet`).
 *
 * - **A stack**: the label, the control, the hint, the error and the count one under another, a small gap between,
 *   each at its own width (a short control is never stretched to the field's).
 * - **Type**: the label in the text color at weight 500, the hint and the count in the muted text color, the shown error
 *   in the danger color, both a step smaller than the label (the survey's 14px label, 12-13px help: shadcn/ui, Mantine,
 *   Primer).
 * - **The control's edge while an error shows**: the field sets the shared border token to the danger color on itself,
 *   so a control that reads `--vera-border` (`<vera-input>`'s box) draws it in red. The field never styles the control.
 * - **Keyed on our own mark** (`data-vera-field`) and part names, never the tag, so `defineAs('my-field')` looks the
 *   same; **zero specificity** (`:where`), so any rule a page writes wins; `data-vera-look="none"` on the field drops
 *   all of it; `[hidden]` is never overridden (the errors not shown are hidden, and stay so).
 */
import { DANGER, FG, FG_MUTED } from '@verajs/shared-utils';

/** The root's key for the field's rules (`adoptOwnSheet`), a `_$…$` name the minifier leaves alone. */
export const SHEET = '_$veraFieldLook$';

/** The field, unless it opted out. */
const field = (more = ''): string => `:where([data-vera-field]:not([data-vera-look="none"])${more})`;

/** A part of the field: a direct child, or one in a wrapper inside it. */
const part = (name: string): string => `${field()} :where([data-vera-part="${name}"])`;

export const LOOK =
  `${field(':not([hidden])')}{display:grid;justify-items:start;gap:.375em}` +
  `${field()}>:where(label){font-size:.875em;font-weight:500;color:${FG}}` +
  `${part('hint')},${part('count')}{font-size:.8125em;color:${FG_MUTED}}` +
  `${part('error')}{font-size:.8125em;color:${DANGER}}` +
  `${field(':has([data-vera-part="error"]:not([hidden]))')}{--vera-border:${DANGER}}`;
