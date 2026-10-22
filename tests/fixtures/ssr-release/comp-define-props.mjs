import { define, html } from '@verajs/core';
import { S } from './store.mjs';
(globalThis.__refs ??= []);
/** comp-define.mjs with DECLARED props read on render: its props record is built on the server and carries its store's slot. */
export default customElements.get('define-props-ssr') ??
  define({ tag: 'define-props-ssr', props: { a: 1, items: [] } }, (host) => {
    globalThis.__refs.push(new WeakRef(host));
    return () => html`<b>${S.n}</b><u>${host.a}${host.items.length}</u>`;
  });
