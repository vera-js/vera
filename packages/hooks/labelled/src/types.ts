/** The vocabulary of `labelled`. */

/**
 * The parts `labelled` wires to a control. Every part is optional, and each is an element the caller already holds:
 * the hook never creates, moves or writes text into one.
 */
export type LabelledParts = {
  /**
   * The element whose own subtree is the calling component (a field's host). When two components wire the same
   * control, the one whose host is NEARER the control owns it, whatever order they ran in.
   */
  host: Element;
  /** The control's visible name: `label[for]` on a labelable control, `aria-labelledby` on any other focus target. */
  label?: Element | null;
  /** Help text, always in the control's description. */
  hint?: Element | null;
  /** A character count or similar live status, always in the control's description. */
  count?: Element | null;
  /** The error messages the caller may show, one at a time; each is in the description only while shown. */
  errors?: readonly Element[];
};

/**
 * What `labelled` hands back. A caller that does not own the control (a farther caller, see `LabelledParts.host`) gets
 * a handle that owns nothing: both calls do nothing.
 */
export type LabelledWiring = {
  /** Shows one of the wired errors (described, and `aria-invalid="true"`), or none with `null`. */
  show: (error: Element | null) => void;
  /** Removes exactly what the wiring added, and puts back every attribute value it found. Idempotent. */
  release: () => void;
};
