/**
 * Written in TSX, compiled by @verajs/jsx into the renderer's tagged templates — zero runtime
 * cost, same engine. React DX on web standards: the component itself stays a platform class.
 * Loaded lazily by the autoloader like every other component.
 */
import { init, createStore, render } from '@verajs/core';

class JsxDemo extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const state = createStore({ n: 0, items: [] as { id: number; label: string }[] });

    render(() => (
      <fieldset>
        <legend>jsx-demo (TSX source)</legend>
        <button onClick={() => state.n++}>clicked {state.n} times</button>
        <button onClick={() => state.items.unshift({ id: Date.now(), label: `item ${state.n}` })} disabled={state.n === 0}>
          add item
        </button>
        <ul>
          {state.items.map((item) => (
            <li key={item.id}>{item.label}</li>
          ))}
        </ul>
        {state.items.length > 0 && <em>{state.items.length} items</em>}
      </fieldset>
    ));
  }
}

customElements.define('jsx-demo', JsxDemo);
