/**
 * **When the character count speaks: a pure function of its last state and the new length.** It counts what
 * `maxlength` counts, the value's UTF-16 code units (`value.length`), so "the limit" is the browser's limit, never a
 * grapheme count that disagrees with it. It speaks once per CROSSING: above 80% of the limit ("N characters left"),
 * and at the limit. A crossing is re-armed only after the length falls back below max(70%, 80% - 5), so a user typing
 * and deleting at the line is not told the same thing on every keystroke. Only the user's own typing speaks: a value set
 * by the page, a reset, or text still being composed (an IME) moves the state silently.
 */

/** What the count has already said: nothing, the near-the-limit warning, or the limit itself. */
export type Spoken = 0 | 1 | 2;

/** The count's next state, and what to say now (null: say nothing). */
export type Step = { readonly spoken: Spoken; readonly say: { readonly left: number } | null };

/** The length above which the near-the-limit warning is due: 80% of the limit. */
const warnAt = (max: number): number => Math.floor(max * 0.8);
/** The length below which a spoken warning is re-armed: max(70%, 80% - 5), so the two lines are apart. */
const rearmBelow = (max: number): number => Math.max(Math.floor(max * 0.7), warnAt(max) - 5);

/**
 * The next state for a value of `length` against a limit of `max`. `typed` is true only for the user's own committed
 * input (an `input` event that is not composing); anything else updates the state and says nothing.
 */
export const step = (spoken: Spoken, length: number, max: number, typed: boolean): Step => {
  let next: Spoken;
  if (length >= max) {
    next = 2;
  } else if (length < rearmBelow(max)) {
    next = 0;
  } else if (length <= warnAt(max)) {
    /** Back at or under the warning line: the limit is re-armed; the warning waits for the re-arm line. */
    next = spoken === 2 ? 1 : spoken;
  } else {
    /** Above the warning line: warned now if not before; a limit already said stays said (a backspace at the limit). */
    next = spoken === 0 ? 1 : spoken;
  }
  const say = typed && next > spoken ? { left: Math.max(0, max - length) } : null;
  return { spoken: next, say };
};
