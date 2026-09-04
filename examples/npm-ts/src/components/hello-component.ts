import { globalState } from '../globalState.js';
import { createStore, init, useEffect, render, html } from '@verajs/core';
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
        </div>
      `;
    });
  }
}

// Define the custom element
customElements.define('hello-component', HelloComponent);
