import { define, html } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__refs ??= []);
/** The same component as comp.mjs, made by `define` — its release goes through the same wrapper and turn. */
export default customElements.get('define-ssr') ??
  define('define-ssr', (host) => {
    globalThis.__refs.push(new WeakRef(host));
    return () => html`<b>${S.n}</b>`;
  });
