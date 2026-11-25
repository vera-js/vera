/** **The stepper's behavior**: the parts, their presses and the steps they make. */
import { adoptOwnSheet } from '@verajs/shared-utils';
import { LOOK, SHEET } from './sheet.js';

/** The repeat while a step part is held, as a native spinner does: a first pause, then a steady rate (ms). */
const HOLD_FIRST = 400;
const HOLD_EVERY = 60;

/**
 * One step of a number input by `direction` (1 or -1): the platform's own `stepUp`/`stepDown` (they clamp to min and
 * max and keep to the step's base), then an `input` event, which they do not fire, only when the value moved (at max,
 * a step up is nothing, as the native spinner's is). `step="any"` makes them throw, so there a step is 1, as the
 * native spinner's is. Returns whether the value moved.
 */
const step = (input: HTMLInputElement, direction: 1 | -1): boolean => {
  const was = input.value;
  if (input.getAttribute('step') === 'any') {
    const at = Number.isNaN(input.valueAsNumber) ? 0 : input.valueAsNumber;
    const max = parseFloat(input.max);
    const min = parseFloat(input.min);
    const to = at + direction;
    input.valueAsNumber = to > max ? max : to < min ? min : to;
  } else if (direction === 1) input.stepUp();
  else input.stepDown();
  if (input.value === was) return false;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};

/** The events that end a press on the stepper. */
const PRESS_ENDS = ['pointerup', 'pointercancel', 'lostpointercapture'];

/** A stepper span: its part name and the mark every part this element writes carries. */
const ourSpan = (doc: Document, name: string): HTMLSpanElement => {
  const span = doc.createElement('span');
  span.setAttribute('data-vera-part', name);
  span.setAttribute('data-vera-input', '');
  return span;
};

/**
 * **The stepper, on a number input**: under the look the engine's own spin buttons are hidden (they drew a box inside
 * the box), and two parts beside the input, `step-down` and `step-up`, step it. They are a pointer's way only: the input
 * is a spinbutton the keyboard already steps (ArrowUp, ArrowDown), so the parts are `aria-hidden` spans, out of the tab
 * order and never focused (a press keeps focus in the input). A press steps once and, held, repeats after a pause, as
 * the native spinner does; `change` fires once, when the press ends (the native spinner fires `input` per step and
 * `change` on release). The repeat stops on release, cancel, lost capture or the input's blur. A disabled or read-only
 * input steps nothing. Side by side, each a 1.5em square: 24px on a 16px page, the WCAG 2.5.8 target, inside the box's
 * height. The listeners are the stepper's own, four for both halves, the half read from the press's target. Returns
 * the release.
 */
const parts = (input: HTMLInputElement): (() => void) => {
  const doc = input.ownerDocument;
  const win = doc.defaultView;
  const holder = ourSpan(doc, 'stepper');
  holder.setAttribute('aria-hidden', 'true');
  const down = ourSpan(doc, 'step-down');
  const up = ourSpan(doc, 'step-up');
  holder.append(down, up);
  let timer = 0;
  let stepped = false;
  const stop = (): void => {
    win?.clearTimeout(timer);
    timer = 0;
    if (!stepped) return;
    stepped = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const onDown = (event: PointerEvent): void => {
    event.preventDefault();
    const direction = event.target === up ? 1 : event.target === down ? -1 : 0;
    if (direction === 0 || input.disabled || input.readOnly || event.button !== 0) return;
    (event.target as Element).setPointerCapture?.(event.pointerId);
    stepped = step(input, direction);
    const again = (): void => {
      if (step(input, direction)) stepped = true;
      timer = win?.setTimeout(again, HOLD_EVERY) ?? 0;
    };
    timer = win?.setTimeout(again, HOLD_FIRST) ?? 0;
  };
  input.after(holder);
  holder.addEventListener('pointerdown', onDown);
  for (const end of PRESS_ENDS) holder.addEventListener(end, stop);
  input.addEventListener('blur', stop);
  return () => {
    stop();
    holder.removeEventListener('pointerdown', onDown);
    for (const end of PRESS_ENDS) holder.removeEventListener(end, stop);
    input.removeEventListener('blur', stop);
    holder.remove();
  };
};

/**
 * The stepper on `input`, its rules adopted into the root `host` renders in, and `host` marked while it serves: the
 * engine spinner is hidden only in a marked box, so an input served before `wire([stepper])` keeps its native one.
 * Returns the release.
 */
export const stepping = (input: HTMLInputElement, host: HTMLElement): (() => void) => {
  adoptOwnSheet(host, SHEET, LOOK);
  host.setAttribute('data-vera-input-stepper', '');
  const release = parts(input);
  return () => {
    release();
    host.removeAttribute('data-vera-input-stepper');
  };
};
