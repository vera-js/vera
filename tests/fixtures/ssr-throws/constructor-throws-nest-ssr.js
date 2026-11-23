/** A healthy component holding one whose CONSTRUCTOR throws: the child's tag is the one named, not this one's. */
export const BUILT = new Error('boom-ctor');
class ConstructorThrowsSsr extends HTMLElement {
  constructor() {
    super();
    throw BUILT;
  }
}
customElements.define('constructor-throws-ssr', ConstructorThrowsSsr);
export default class ConstructorThrowsNestSsr extends HTMLElement {
  connectedCallback() {
    this.innerHTML = '<p>before</p><constructor-throws-ssr></constructor-throws-ssr>';
  }
}
customElements.define('constructor-throws-nest-ssr', ConstructorThrowsNestSsr);
