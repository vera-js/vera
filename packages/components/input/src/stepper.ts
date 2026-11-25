/**
 * **`@vera-components/input/stepper`**: a number stepper for `<vera-input>`, wired once: `wire([stepper])`. With it, a
 * number input's engine spinner is hidden and `step-down` and `step-up` parts step it; without it, the input keeps the
 * engine's own spinner, and none of these bytes are on the page.
 *
 * The descriptor is an `init` insert whose function does nothing (every element's init calls it: one call that returns)
 * and carries the stepper as `$inputStepper`, which `<vera-input>` finds in core's registry. It imports nothing from
 * the element, and the element nothing from it.
 */
import { stepping } from './stepper/stepping.js';

/** The insert function: nothing at init; the stepper rides on it. */
const marker = Object.assign((): void => undefined, { $inputStepper: stepping });

/** `wire([stepper])`: a bare descriptor (no options). */
export const stepper = { name: '@vera-components/input/stepper', on: 'init', fn: marker, priority: 90 } as const;
