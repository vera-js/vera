import { html, init, render, useEffect, setRenderer, ref } from '@verajs/core';
import { hydrate } from '@lit-labs/ssr-client';

import './parent-element.js';
import './child-element.js';
import './quantity-picker.js';
import './name-acquire.js';
import './wcc-single-element.js';

// IGNORE FOR NOW - NOT NEEDED TO HYDRATE
// import { render as SSRRender } from '@lit-labs/ssr/lib/render-with-global-dom-shim.js';
// import { collectResult, collectResultSync } from '@lit-labs/ssr/lib/render-result.js';

// setRenderer((content, element) => {
//   element.innerHTML = collectResultSync(SSRRender(content));
// });

// const template = document.createElement('template');

// template.innerHTML = `
//   <style>
//     .footer {
//       color: white;
//       background-color: #192a27;
//     }
//   </style>

//   <footer class="footer">
//     <h4>My Blog &copy; ${new Date().getFullYear()}</h4>
//   </footer>
// `;

class MainElement extends HTMLElement {
  connectedCallback() {
    init(this);
    useEffect(() => {});

    const template = () => {
      return html`<parent-element><div>HI FRIENDS!!</div></parent-element>`;
    };

    if (typeof window !== 'undefined') {
      console.log('hydrating');
      hydrate(template, this);
    }

    // if (!document.querySelector) {
    console.log('rendering');
    render(template);
    // }
  }
}
export default MainElement;

customElements.define('main-element', MainElement);
