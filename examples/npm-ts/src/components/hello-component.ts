import { html } from 'lit-html';
import { globalState } from '../globalState.js';
import { createStore, init, useEffect, render } from '@verajs/core';
import { discover } from 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/shoelace-autoloader.js';

class HelloComponent extends HTMLElement {
  connectedCallback() {
    // const container = document.createElement('div');
    init(this, { mode: 'open' });
    const state = createStore({ showGoodbye: false });

    // const { setGoodbye, setHello } = globalSetters;

    const toggleGoodbye = () => {
      state.showGoodbye = !state.showGoodbye;
    };

    // bindStore(globalState, this);

    const changeAlert = () => {
      globalState.goodbye = globalState.goodbye === 'success' ? 'danger' : 'success';
    };

    useEffect(() => {
      // const { goodbye } = globalState;
      console.log('CALLING THAT ONE FUNCTION');
    });

    useEffect(() => {
      discover(this.shadowRoot);
    });
    console.log('RIGHT BEFORE RENDER');

    render(() => {
      return html`
        <div class="input-grid bg-red font-bold">
          <slot name="test-slot"></slot>
          <button @click=${toggleGoodbye}>Toggle Goodbye</button>
          <button @click=${changeAlert}>Toggle Variant</button>
          ${state.showGoodbye ? html`<goodbye-component></goodbye-component>` : ''}
          <!-- <quantity-picker load></quantity-picker> -->
          <sl-image-comparer>
            <img
              slot="before"
              src="https://images.unsplash.com/photo-1517331156700-3c241d2b4d83?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=800&q=80&sat=-100&bri=-5"
              alt="Grayscale version of kittens in a basket looking around." />
            <img
              slot="after"
              src="https://images.unsplash.com/photo-1517331156700-3c241d2b4d83?ixlib=rb-1.2.1&ixid=eyJhcHBfaWQiOjEyMDd9&auto=format&fit=crop&w=800&q=80"
              alt="Color version of kittens in a basket looking around." />
          </sl-image-comparer>
        </div>
      `;
    });
  }
}

// Define the custom element
customElements.define('hello-component', HelloComponent);
