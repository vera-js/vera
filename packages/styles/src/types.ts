/** A constructed stylesheet paired with its source text — shared with core, one home. */
export type { CSSResultGroup } from '@verajs/shared-types';

/** Any element that may carry `static styles` on its constructor. */
export interface StyledElement extends HTMLElement {
  shadowRoot: ShadowRoot | null;
}
