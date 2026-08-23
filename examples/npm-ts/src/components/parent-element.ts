import { html, init, render, createStore } from '@verajs/core';

class ParentElement extends HTMLElement {
  /** Assigned in `connectedCallback`; `declare` so no field initializer is emitted. */
  declare test: string;

  connectedCallback() {
    init(this);
    this.test = 'hello';
    const item = createStore({ message: 'Hello Dark World' });
    const lightWorld = () => {
      console.log('hello');
      item.message = 'Hello Light World';
    };
    render(
      () =>
        html`<wcc-footer></wcc-footer><quantity-picker></quantity-picker><quantity-picker></quantity-picker
          ><child-element .item=${item}></child-element>
          <p>${this.test}</p>
          <button
            @click=${() => {
              lightWorld();
            }}>
            Click Me
          </button>
          <slot></slot>`
    );
  }
}

customElements.define('parent-element', ParentElement);

export default ParentElement;
