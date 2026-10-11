import { init, html, createStore } from '@verajs/core';

/** Components that wait on a definition the server never makes — see `tests/ssr-when-defined.test.mjs`. */
class WaitReturned extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>returned</p>`;
    });
    requestAnimationFrame(() => customElements.whenDefined('wd-never-defined'));
  }
}
class WaitAsync extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>async</p>`;
    });
    requestAnimationFrame(async () => {
      await customElements.whenDefined('wd-never-defined');
      this.setAttribute('data-ready', '');
    });
  }
}
class WaitPlain extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p>plain</p>`;
    });
    requestAnimationFrame(() => new Promise(() => {}));
  }
}
/** The waiting component nested in a page that waits on nothing: the warning must name the one waiting. */
class WaitOuter extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<section><wait-async></wait-async></section>`;
    });
  }
}
/** The README's fix, against the same component without it: one shape, a state the wait would change. */
const waiting = (guarded) =>
  class extends HTMLElement {
    async connectedCallback() {
      const state = createStore({ ready: false });
      init({ host: this, shadow: 'open' }, () => {
        return () => html`<p>${state.ready ? 'ready' : 'loading'}</p>`;
      });
      if (guarded && globalThis.__veraSsrShimmed) return;
      await customElements.whenDefined('wd-never-defined');
      state.ready = true;
    }
  };
customElements.define('wait-outer', WaitOuter);
customElements.define('wait-unguarded', waiting(false));
customElements.define('wait-guarded', waiting(true));
customElements.define('wait-returned', WaitReturned);
customElements.define('wait-async', WaitAsync);
customElements.define('wait-plain', WaitPlain);
/** A second name for a row that asserts its own timeout warning — said once per process per component. */
customElements.define('wait-plain-again', class extends WaitPlain {});
export default WaitReturned;
