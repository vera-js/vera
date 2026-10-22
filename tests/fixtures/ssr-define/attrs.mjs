import { define, html } from '@verajs/core';
/** Attributes on the server: the shim delivers observed attributes before connect, so the markup carries them. */
export default customElements.get('ssr-define-attrs') ??
  define({ tag: 'ssr-define-attrs', props: { tone: 'plain' }, attributes: ['label', 'data-count', 'tone'] }, (host) => () => html`<b>${host.label}</b><i>${host.dataCount}</i><u>${host.tone}</u>`);
