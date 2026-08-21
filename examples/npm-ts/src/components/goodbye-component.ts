import { html } from 'lit-html';
import { initRouter } from '@verajs/router';
import { globalState } from '../globalState.js';
import { css, init, createStore, useEffect, render, deps, useLayoutEffect, ref } from '@verajs/core';
import { discover } from 'https://cdn.jsdelivr.net/npm/@shoelace-style/shoelace@2.16.0/cdn/shoelace-autoloader.js';

const generateLargeObject = (depth, breadth) => {
  function createNestedObject(level) {
    if (level > depth) return null;

    const obj = {};
    for (let i = 0; i < breadth; i++) {
      obj[`key${i}`] =
        level % 2 === 0 ? createNestedObject(level + 1) : Array.from({ length: breadth }, (_, idx) => `value${idx}`);
    }
    return obj;
  }

  return createNestedObject(0);
};

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

class GoodbyeComponent extends HTMLElement {
  static styles = [styles, inputStyles];

  connectedCallback() {
    init(this, { mode: 'open' });
    let componentInit = false;
    const state = createStore({
      hello: { name: { first: 'hello', last: 'goodbye' } },
      goodbye: 'hello',
      color: 'red',
      // testSet: new Set(['hello', 'goodbye']),
      // map: new Map([['hello', 'Little Women']]),
      // testObject: {
      //   name: 'testObject',
      // },
      bigTest: { littleTest: 'LITTLE TEST' },
      ...generateLargeObject(20, 100),
    });

    const testMap = createStore(new Map([['hello', 'Little Women']]));

    const testRef = ref(0);

    useEffect(() => {
      console.log(state.hello);
    });

    useEffect(() => {
      console.log('STATE CHANGED!!!', state.hello.name.last);
    });

    // const stateMachine = ref(new Map([['hello', 'goodbye']]));

    // useEffect(() => {
    //   console.log('State machine value: ', stateMachine.value.get('hello'));
    // });
    // useEffect(() => {
    //   console.log('State map value: ', state.map.get('hello'));
    // });
    // useEffect(() => {
    //   // console.log('State set value: ', state.set);

    //   const newValue = state.testSet.has('goodbye');
    //   console.log("state.testSet.has('goodbye') changed", newValue);
    // });
    // useEffect(() => {
    //   state.map.get('hello');
    // });
    // useEffect(() => {
    //   const newValue = testMap.get('hello');
    //   console.log("state.testMap.get('hello') changed", newValue);
    // });

    useEffect(() => {
      console.log(testRef);
    });
    // useEffect(() => {
    //   state.testObject;
    // });

    useEffect(() => {
      const router = initRouter(this, { view: 'main' });

      router?.addRoutes([
        {
          path: '/light',
          title: () => `LIGHT! ${state.hello.name.first}`,
          component: () => html`<hello-component></hello-component>`,
        },
      ]);
    });

    useEffect((signal) => {
      // const { hello: hello2 } = hello;
      deps(state.hello.name.first, state.goodbye, state.color);
      if (componentInit) {
        if (signal?.prop === 'first') console.log('hello.name.first changed', state.hello.name.first);
        if (signal?.prop === 'last')
          console.log('hello.name.last changed - you shouldnt see this', state.hello.name.last);
        if (signal?.prop === 'color') console.log('color changed', state.color);
      }
    });

    useEffect(() => {
      deps(state.bigTest.littleTest);
      if (componentInit) console.log(state.bigTest.littleTest);
    });

    useEffect(() => {
      console.log('first run EFFECT');
    });

    this.cleanUp = () => {
      console.log('unmounting');
    };

    useLayoutEffect(() => {
      console.log('useLayoutEffect *** Global State Hello', globalState.hello);
    });

    useEffect(() => {
      console.log('useEffect *** Global State Hello', globalState.hello);
    });

    const inputHelloNameFirst = (e) => {
      globalState.hello = e.target.value;
    };
    const inputHelloNameLast = (e) => {
      state.hello.name.last = e.target.value;
    };

    const changeColor = () => {
      state.color = 'blue';
    };

    function randomString(length = 8) {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    }

    const changeStateMachine = () => {
      state.testSet.delete('goodbye');
      state.map.set('hello', randomString());
      testMap.set('hello', randomString());
      state.testObject = 'FKLAKLJSDF';
      // console.log(stateMachine.value);
    };

    useEffect(() => {
      discover(this.shadowRoot);
    });

    render(() => {
      console.log('RENDER *** Global State Hello', globalState.hello);
      return html`
        <style>
          * {
            --custom-color: ${state.color};
          }
        </style>
        <div>
          <a route href="/light">light</a>
          <div view="main"></div>
          <p>${globalState.hello}</p>
          <p>${testMap.get('hello')}</p>
          <button
            @click=${() => {
              testRef.value++;
            }}>
            Test ref to the moon!
          </button>
          <quantity-picker></quantity-picker>
          <button @click=${changeStateMachine}>Change state machine</button>
          <button @click=${changeColor}>Change Color</button>
          <input @input=${inputHelloNameFirst} type="text" .value="${globalState.hello}" />
          <input @input=${inputHelloNameLast} type="text" .value="${state.hello.name.last}" />
          <hello-component></hello-component>
          <sl-tab-group>
            <sl-tab slot="nav" panel="general">General</sl-tab>
            <sl-tab slot="nav" panel="custom">Custom</sl-tab>
            <sl-tab slot="nav" panel="advanced">Advanced</sl-tab>
            <sl-tab slot="nav" panel="disabled" disabled>Disabled</sl-tab>

            <sl-tab-panel name="general">General Tab</sl-tab-panel>
            <sl-tab-panel name="custom">Another Tab</sl-tab-panel>
            <sl-tab-panel name="advanced">This is the advanced tab panel.</sl-tab-panel>
            <sl-tab-panel name="disabled">This is a disabled tab panel.</sl-tab-panel>
          </sl-tab-group>
          <slot name="hello-slot"></slot>
        </div>
      `;
    });

    componentInit = true;
  }

  disconnectedCallback() {
    this.cleanUp();
  }
}

customElements.define('goodbye-component', GoodbyeComponent);
