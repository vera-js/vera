/**
 * **<vera-input>'s decisions, pure: what shows and what is copied, from values read off the input and the host** (no
 * DOM read, no state). The element reads, these decide, the element writes.
 */

/** What the clear decision reads of the input. */
export type ClearState = {
  readonly value: string;
  readonly disabled: boolean;
  readonly readOnly: boolean;
  /** The input's `aria-expanded`: a composite (a combobox) owns Escape and clearing while its list is open. */
  readonly expanded: string | null;
};

/**
 * **Clear shows when there is something the user may clear**: a value, on an input that is neither disabled nor
 * read-only, and not while a composite's list is open (the composite owns clearing then).
 */
export const clearShown = (state: ClearState): boolean =>
  state.value !== '' && !state.disabled && !state.readOnly && state.expanded !== 'true';

/**
 * **Escape clears only on a search input** (the platform's own search key), and only when clear would show: a combobox
 * with its list open keeps Escape for closing the list.
 */
export const escapeClears = (type: string, state: ClearState): boolean =>
  type.toLowerCase() === 'search' && clearShown(state);

/**
 * **The host attributes a default input is made from, read ONCE at render.** Only these names, never markup: after the
 * render the input is the source of truth and later host changes are not mirrored (development warns when one changes).
 */
export const COPIED = ['name', 'type', 'value', 'placeholder', 'autocomplete'] as const;

/** One host attribute a default input copies. */
export type Copied = (typeof COPIED)[number];

/** The copied attributes present on the host, in `COPIED`'s order, each value as the host has it. */
export const copiedFrom = (read: (name: Copied) => string | null): [Copied, string][] => {
  const out: [Copied, string][] = [];
  for (const name of COPIED) {
    const value = read(name);
    if (value !== null) out.push([name, value]);
  }
  return out;
};

/** The development warnings a host and its input call for, by code, each decided from values alone. */
export type Warning = 'input-no-name' | 'input-reveal-not-password' | 'input-size-on-host';

/** What the warnings decision reads of the host and its input. */
export type WarnState = {
  /** The input has an accessible name (a label, `aria-label`, `aria-labelledby`, or a `title`). */
  readonly named: boolean;
  /** The host asks for `reveal`. */
  readonly reveal: boolean;
  /** The input's `type` at render, before any reveal. */
  readonly type: string;
  /** The host carries `size` (which `<input size>` means; the scale is `scale`). */
  readonly sizeOnHost: boolean;
};

/** Which warnings fire, in a fixed order: each fires once per element (the element remembers). */
export const warnings = (state: WarnState): Warning[] => {
  const out: Warning[] = [];
  if (!state.named) out.push('input-no-name');
  if (state.reveal && state.type.toLowerCase() !== 'password') out.push('input-reveal-not-password');
  if (state.sizeOnHost) out.push('input-size-on-host');
  return out;
};
