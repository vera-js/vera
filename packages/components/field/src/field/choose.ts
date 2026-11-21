/**
 * **Which error a field shows, and its text: a pure function of the control's validity and the field's error parts**
 * (no DOM read, no state). The first part, in tree order, whose `data-when` names a `ValidityState` key that is true;
 * else the first part with no `data-when` (the catch-all); else none. The text is the part's own when it has some, else
 * the browser's `validationMessage` (its own words, localized), so an empty catch-all part shows the browser's message.
 * A part `data-when="server"` is never chosen here: it is a server's standing error, which the element shows itself.
 */

/** The `ValidityState` keys a `data-when` may name (every one but `valid`, which is never an error). */
export const VALIDITY_KEYS = [
  'badInput',
  'customError',
  'patternMismatch',
  'rangeOverflow',
  'rangeUnderflow',
  'stepMismatch',
  'tooLong',
  'tooShort',
  'typeMismatch',
  'valueMissing',
] as const;

export type ValidityKey = (typeof VALIDITY_KEYS)[number];

/** What the chooser reads of the control: its validity flags and the browser's message. */
export type Validity = { readonly valid: boolean; readonly validationMessage: string } & Readonly<Partial<Record<ValidityKey, boolean>>>;

/** One error part as the chooser sees it: its `data-when` (null when absent) and its own trimmed text. */
export type ErrorPart = { readonly when: string | null; readonly text: string };

/** The part to show (its index in the parts given) and the text to show in it; null when nothing shows. */
export type Choice = { readonly index: number; readonly text: string } | null;

/** A `data-when` value names a key the chooser can test. Anything else never matches (development warns). */
export const isValidityKey = (when: string): when is ValidityKey => (VALIDITY_KEYS as readonly string[]).includes(when);

export const choose = (validity: Validity, parts: readonly ErrorPart[]): Choice => {
  if (validity.valid) return null;
  let index = -1;
  for (let i = 0; i < parts.length; i++) {
    const when = parts[i].when;
    if (when !== null && isValidityKey(when) && validity[when] === true) {
      index = i;
      break;
    }
  }
  if (index === -1) index = parts.findIndex((part) => part.when === null);
  if (index === -1) return null;
  return { index, text: parts[index].text === '' ? validity.validationMessage : parts[index].text };
};
