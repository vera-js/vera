/** **The selectors <vera-input>'s rules key on**, shared by its look and the stepper's. */

/** A part, unless the host or the part itself opted out of the look. */
export const part = (name: string, more = ''): string =>
  `:where(:not([data-vera-look="none"])>[data-vera-part="${name}"][data-vera-input]:not([data-vera-look="none"])${more})`;

/**
 * The box: the host, found by its mark (valued with its scale), unless it opted out. The box is the host, not the input,
 * because the clear, reveal and loading parts sit beside the input: a border on the input alone left them outside it.
 */
export const box = (more = ''): string => `:where([data-vera-input-host]:not([data-vera-look="none"])${more})`;

/** The inner input, structurally: above a page's ordinary input rules (see the box's rules). */
export const inner = `${box()} input[data-vera-input]:not([data-vera-look="none"])`;

