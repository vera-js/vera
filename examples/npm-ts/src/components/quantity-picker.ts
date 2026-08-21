// import { html } from 'lit-html';
import { css, html, init, ref, render, createStore } from '@verajs/core';

const styles = css`
  * {
    --custom-color: purple;
    color: var(--custom-color);
  }
`;

const inputStyles = css`
  input {
    color: green;
  }
`;

class QuantityPicker extends HTMLElement {
  static styles = [styles, inputStyles];

  connectedCallback() {
    init(this, { mode: 'open' });

    const globalStore = createStore({ name: 'hello' });

    const counter = ref(0);
    const name = ref('hello friend');

    const incrementCounter = () => {
      console.log('hello');
      counter.value++;
      globalStore.name = 'goodbye';
    };

    const checked = ref(true);

    const setChecked = () => {
      checked.value = !checked.value;
    };

    const changeName = (e) => {
      console.log(e);
      name.value = e.target.value;
    };


    // TODO Add the ? check and logic in the main renderer, based off of the ssr-renderer
    render(
      () => html`<div>
        <h2>here is some content</h2>
        <p>${counter.value}</p>
        <button @click=${incrementCounter}>Increment me</button>
        <input .value=${name.value} @input=${changeName} type="text" />
        <input .value=${name.value} @input=${changeName} type="text" />
        <input ?checked=${checked.value} @click=${setChecked} type="checkbox" />
        <name-acquire .store=${globalStore}></name-acquire>
      </div>`
    );

    // Non lit way - values in input don't render because we don't have a custom server-side render
    // function that tells them what to do. This is a big TODO
    // render(
    //   () => html`<div>
    //     <h2>here is some content</h2>
    //     <p>${counter.value}</p>
    //     <button onclick="incrementCounter">Increment me</button>
    //     <input .value="${name.value}" oninput="changeName" type="text" />
    //     <input .value="${name.value}" oninput="changeName" type="text" />
    //     <name-acquire .store="globalStore"></name-acquire>
    //   </div>`,
    //   { incrementCounter, changeName, globalStore }
    // );
  }
}

customElements.define('quantity-picker', QuantityPicker);

export default QuantityPicker;

// const showHello = ref(false);
// const name = ref('asdfasfd');

// const showHelloClick = () => (showHello.value = !showHello.value);

// const incrementCounter = () => {
//   counter.value++;
// };

// this.addEventListener('click', (e) => {
//   console.log(e);
//   switch (e.target.tagName) {
//     case 'button':
//       (() => {
//         console.log('hello');
//       })();
//       break;
//   }
// });

// const changeName = (e) => {
//   console.log('changing input');
//   name.value = e.target.value;
// };

// render(
//   () => html`<div>
//     <h2>here is some content</h2>

//     <p>${counter.value}</p>
//     <button onclick="incrementCounter()">Increment me</button>
//     ${showHello.value ? `<p>Hello there</p>` : `<p>Goodbye</p>`}
//     <button onclick="showHelloClick()">Increment me</button>
//     <p></p>
//     <input oninput="changeName()" @value="${name.value}" type="text" />
//     <input oninput="changeName()" @value="${name.value}" type="text" />
//   </div>`,
//   { incrementCounter, showHelloClick, changeName }
// );
