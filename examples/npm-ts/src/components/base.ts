import { init, createStore, useEffect, useLayoutEffect, render } from '@verajs/core';
import { initRouter } from '@verajs/router';
import { html } from 'lit-html';
import { globalState } from '../globalState.js';
/** @ts-expect-error No module declarations */
import { discover } from 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/shoelace-autoloader.js';
import { testingChunks } from './logic-chunk.js';

// import { ref, createRef } from 'https://cdn.jsdelivr.net/npm/lit-html@3.2.0/directives/ref.js';

const hello = () => html`<hello-component autoloader>Loading hello...</hello-component>`;
const goodbye = () => html`<goodbye-component autoloader>Loading goodbye...</goodbye-component>`;

class Base extends HTMLElement {
  connectedCallback() {
    // this.innerHTML = '<template shadowrootmode="open"><slot></slot><h2>Hello there!</h2></template>';
    init(this, { mode: 'open' });

    useEffect(() => {
      const router = initRouter(this, { view: 'main' })!;
      router.addRoutes([
        { path: '/', title: 'Home', component: () => html`<p>Home is where the heart is</p>` },
        {
          path: '/fellow/john:id/believe:name',
          title: 'FELLOW',
          component: (params) => html`<div>FELLOW ${params.id} ${params.name}</div>`,
        },
        {
          path: '/hello',
          title: 'Hello',
          component: hello,
          children: [
            {
              path: '/fever*wildcard_1',
              title: 'Hello Wildcard',
              component: (params) => html`<div>Hello ${params.wildcard_1}</div>`,
              children: [
                {
                  path: '/forever:id|forever/john/*wildcard_2|forever',
                  title: 'Hello!',
                  component: (params) => {
                    console.log(params);
                    return html`<div style="width: 300px; height: 300px: background-color: red">
                      Hello ${params.name} ${params.id}
                    </div>`;
                  },
                },
              ],
            },
          ],
        },

        { path: '/goodbye', title: 'Goodbye!', component: goodbye },
        {
          path: '/*wildcard',
          title: '404',
          component: (params) => {
            return html`<div style="width: 300px; height: 300px: background-color: purple">404${params.wildcard}</div>`;
          },
        },
      ]);

      router.on('before-route', (params) => {
        console.log('before route!', params);
      });
    });

    const testingState = testingChunks();

    useLayoutEffect(() => {
      console.log('TESTING STATE CHUNK GLDKJGLDKGFJKL', testingState, testingState.test);
    });

    const silentState = { init: false };
    const state = createStore({
      harry: 'harry',
      hermione: { name: { name: 'hermione' } },
      showButton: false,
    });

    // bindStore(globalState, app);
    useLayoutEffect(() => {
      console.log('USE LAYOUT EFFECT');
      console.log('harry changed!', state.harry);
    });

    useEffect(() => {
      console.log('USE EFFECT');
      console.log('harry changed!', state.harry);
    });

    useEffect(() => {
      console.log('HELLO CHANGED!!!', globalState.goodbye);
    });

    useEffect(() => {
      console.log('Hermione always watching', state.hermione);
    });

    useEffect(() => {
      const { hermione } = state;
      const { name } = hermione;
      const { name: name2 } = name;
      if (silentState.init) {
        console.log('hermione changed!', name2);
      }
    });

    const inputHarry = (e: Event) => {
      state.harry = (e.target as HTMLInputElement).value;
    };

    const inputHermione = (e: Event) => {
      state.hermione.name.name = (e.target as HTMLInputElement).value;
    };

    const cleanUpEffects = () => {
      console.log('cleaning up');
      state._delete();
    };

    const toggleButton = () => {
      state.showButton = !state.showButton;
    };

    useEffect(() => {
      discover(this.shadowRoot);
    });

    const inputTestingState = (e: Event) => {
      testingState.test = (e.target as HTMLInputElement).value;
    };

    // const hello = document.querySelector('.hello');
    // hello.getInput = () => globalStore.hello;
    // hello.setInput = setHello;

    render(() => {
      const { harry, hermione, showButton } = state;
      const { test } = testingState;

      return html`
        <nav style="display: flex; width: 20rem; justify-content: space-between;">
          <a route href="/hello">hello</a><a route href="/goodbye">goodbye</a>
          <a route href="/hello/feverjohn/leave/forever1234forever/john/goodbyeforever">hello john</a>
          <a route href="/hello#goodbye">SCROLLL</a>
        </nav>
        <div view="main" autoloader></div>
        <hello-component></hello-component>
        <div class="input-grid">
          <p>${harry}</p>
          <p>${hermione.name.name}</p>
          <input @input=${inputTestingState} class="input-harry" type="text" .value="${test}" />
          <input @input=${inputHarry} class="input-harry" type="text" .value="${harry}" />
          <input
            @input=${inputHermione}
            class="input-hermione border-2 border-solid border-black ${hermione.name.name}"
            data-attribute="${hermione.name.name}"
            type="text"
            .value="${harry}" />
          <button @mouseover=${toggleButton} @mouseleave=${toggleButton}>Hover Me</button>
          <button @click=${cleanUpEffects}>clean up effects</button>
          ${showButton
            ? html`<div style="width: 200px; height: 300px; background-color: red;">Hello friend! ${harry}</div>`
            : ''}
        </div>
        <!-- <hello-component load></hello-component> -->
      `;
    });

    silentState.init = true;
  }
}

customElements.define('base-element', Base);

// const dataComponent = document.querySelector('#my-data-component');
// dataComponent.setData = setHarry;

// Retrieve data form the data getter
// console.log("data component", dataComponent.data);

// set the data setter equal to setHarry;
