/**
 * **When the character count speaks: a pure function of its last state and the new length.** It counts what
 * `maxlength` counts, the value's UTF-16 code units (`value.length`), so "the limit" is the browser's limit, never a
 * grapheme count that disagrees with it. It speaks once per CROSSING: from ceil(80%) of the limit ("N characters left"),
 * and at the limit. A crossing is re-armed only after the length falls back to floor(max(70%, 80% - 5)), so a user typing
 * and deleting at the line is not told the same thing on every keystroke. Only the user's committed input is judged
 * (typing, a paste, an undo or redo): a value the page sets, a reset or a `maxlength` change is not judged at all, so
 * the next committed input judges from its own length (a reset and retype warns again with no reset hook), and text
 * still being composed (an IME) is judged once, at `compositionend`.
 */

/** What the count has already said: nothing, the near-the-limit warning, or the limit itself. */
export type Spoken = 0 | 1 | 2;

/** The count's next state, and what to say now (null: say nothing). */
export type Step = { readonly spoken: Spoken; readonly say: { readonly left: number } | null };

/**
 * The lines, in whole characters: the warning is due from ceil(80%) of the limit; it is re-armed at or below
 * floor(max(70%, 80% - 5)), so the two lines are apart. Where the warning line reaches the limit (a `maxlength` of 1 to
 * 4), there is no separate warning: only the limit speaks.
 */
const warnFrom = (max: number): number => Math.ceil(max * 0.8);
const rearmAt = (max: number): number => Math.floor(Math.max(max * 0.7, max * 0.8 - 5));

/**
 * The next state, and what to say, for the user's committed input leaving a value of `length` against a limit of `max`.
 * Called for committed input only (see above): nothing else is judged.
 */
export const step = (spoken: Spoken, length: number, max: number): Step => {
  let next: Spoken;
  if (length >= max) {
    next = 2;
  } else if (length <= rearmAt(max)) {
    next = 0;
  } else if (length < warnFrom(max)) {
    /** Back at or under the warning line: the limit is re-armed; the warning waits for the re-arm line. */
    next = spoken === 2 ? 1 : spoken;
  } else {
    /** Above the warning line: warned now if not before; a limit already said stays said (a backspace at the limit). */
    next = spoken === 0 ? 1 : spoken;
  }
  const say = next > spoken ? { left: Math.max(0, max - length) } : null;
  return { spoken: next, say };
};
