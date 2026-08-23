import { html, init, render } from '@verajs/core';

class ChildElement extends HTMLElement {
  /**
   * Set from outside by the parent's `.item=${item}` binding.
   *
   * `declare` matters: a plain `item?: …` field emits an initializer under ES2022 class fields,
   * which runs at upgrade and would wipe a value assigned before the element upgraded. `declare`
   * describes the property without emitting anything.
   */
  declare item?: { message: string };

  connectedCallback() {
    init(this);
    render(() => html`<p>${this.item?.message}</p>`);
  }
}

customElements.define('child-element', ChildElement);
