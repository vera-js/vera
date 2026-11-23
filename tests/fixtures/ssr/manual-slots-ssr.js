/** A component that assigns its slots by hand (`slotAssignment: 'manual'`), and one that slots by name. */
export class ManualSlotsSsr extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open', slotAssignment: 'manual' });
    root.innerHTML = '<slot></slot>';
  }
}
export class NamedSlotsSsr extends HTMLElement {
  connectedCallback() {
    const root = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot></slot>';
  }
}
customElements.define('manual-slots-ssr', ManualSlotsSsr);
customElements.define('named-slots-ssr', NamedSlotsSsr);
export default ManualSlotsSsr;
