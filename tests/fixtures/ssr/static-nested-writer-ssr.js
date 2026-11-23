/**
 * A module-level store written during the render: at its top level (`nested-top`, refused by `static: true`) and below
 * it (the rest, which a static render does not catch). Built for `tests/ssr-static-nested-writes.test.mjs`.
 */
import { init, html, createStore } from '@verajs/core';

export const shared = createStore({ top: 0, list: [1], o: { a: 1, deep: { b: 1 } }, frozen: Object.freeze({ inner: { c: 1 } }) });

const writes = {
  'nested-top': () => { shared.top = 1; },
  'nested-push': () => { shared.list.push(2); },
  'nested-index': () => { shared.list[0] = 9; },
  'nested-length': () => { shared.list.length = 0; },
  'nested-assign': () => { shared.o.a = 2; },
  'nested-deep': () => { shared.o.deep.b = 2; },
  'nested-delete': () => { delete shared.o.a; },
  'nested-define': () => { Object.defineProperty(shared.o, 'z', { value: 1 }); },
};
for (const [tag, write] of Object.entries(writes))
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => () => html`<p>${shared.list.join(',')} ${shared.o.a} ${shared.o.deep.b}</p>`);
      write();
    }
  });

/** Reads only: the same markup both ways, a nested record's identity held across reads, a frozen record answered. */
customElements.define('nested-reader', class extends HTMLElement {
  connectedCallback() {
    const same = shared.o === shared.o && shared.list === shared.list;
    init({ host: this, shadow: 'open' }, () => () => html`<p>${shared.list.map((n) => n * 2).join(',')} ${shared.o.deep.b} ${same} ${shared.frozen.inner.c}</p>`);
  }
});
