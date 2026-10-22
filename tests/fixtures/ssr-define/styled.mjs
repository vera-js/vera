import { define, html } from '@verajs/core';
/** `define`'s `styles` OPTION, rendered on the server: the declarative shadow root carries it. */
export default customElements.get('ssr-styled') ??
  define({ tag: 'ssr-styled', shadow: 'open', styles: 'b { color: rgb(1, 2, 3); }' }, () => () => html`<b>styled</b>`);
