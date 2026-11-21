import { define, html } from '@verajs/core';
/** `define`'s `formAssociated` OPTION on the server: the static is set, and the setup's one `attachInternals()` call works. */
const internalsOf = new WeakMap();
export default customElements.get('ssr-form') ??
  define({ tag: 'ssr-form', formAssociated: true }, (host) => {
    if (!internalsOf.has(host)) internalsOf.set(host, host.attachInternals());
    return () => html`<b>form ${typeof internalsOf.get(host)?.setFormValue}</b>`;
  });
