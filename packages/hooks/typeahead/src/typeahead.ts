/**
 * **Typeahead, as the APG select-only combobox prescribes**: printable characters accumulate for half a second, and the
 * highlight jumps to the next enabled label with that prefix, wrapping, starting after the current row so that
 * pressing one letter again cycles its matches. Pure: a buffer, the caller's clock and the caller's rows, no store and
 * no DOM, so one instance serves every key path of one control (the trigger and the open menu share it: two buffers
 * would split a word typed across a focus move).
 */

/** How long a buffer stays warm after its last character: the native `<select>`'s window. */
const WINDOW_MS = 500;

/** A row as typeahead reads it: its label, and whether it may take the highlight. */
export type TypeaheadRow = { readonly label: string; readonly disabled?: boolean | undefined };

export const createTypeahead = () => {
  let typed = '';
  let typedAt = 0;
  return {
    /**
     * A warm buffer means the user is mid-word, so Space is a CHARACTER ("New York"), exactly the native `<select>`
     * rule; cold, Space acts.
     */
    warm: (now: number): boolean => typed !== '' && now - typedAt < WINDOW_MS,
    /**
     * Add `character` and answer the row it lands on, or -1 for none. A buffer of ONE repeated character cycles that
     * letter's matches, per APG: accumulating `cc` would search for a `cc` prefix (nothing) and freeze on the first
     * match. A real multi-character prefix (`ch`) refines in place. So the needle is the single letter when the buffer
     * is all one character and the whole buffer otherwise, and the search starts at the NEXT row for a repeated letter
     * (to advance the cycle) and at the CURRENT row for a real prefix (to narrow without moving off it).
     */
    type: (character: string, now: number, rows: readonly TypeaheadRow[], active: number): number => {
      typed = (now - typedAt < WINDOW_MS ? typed : '') + character.toLowerCase();
      typedAt = now;
      const repeated = [...typed].every((c) => c === typed[0]);
      const needle = repeated ? (typed[0] ?? '') : typed;
      for (let offset = repeated ? 1 : 0; offset <= rows.length; offset++) {
        const index = (active + offset) % rows.length;
        const row = rows[index];
        if (row && !row.disabled && row.label.toLowerCase().startsWith(needle)) return index;
      }
      return -1;
    },
  };
};
