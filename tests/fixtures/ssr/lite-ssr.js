/** SSR fixture: lite components (`@verajs/lite`), rendered by tests/lite-ssr.test.mjs through @verajs/ssr. */
import { define, html } from '@verajs/lite';

define('ssr-lite', () => () => html`<p title=${'a"b'}>${'<x>'}</p>`);

/** Every hole kind lite binds, as the server's DOM runs them. */
define('ssr-lite-kinds', () => () =>
  html`<ul class="a ${'b'} c">${[1, 2].map((n) => html`<li>${n}</li>`)}</ul><title>${'</title><i>t'}</title><textarea>${'v'}</textarea><style>p{--x:${'</style><i>s'}}</style><script type="application/json">${'{"a":"</script><i>j"}'}</script><input .value=${'typed'} ?disabled=${true} @click=${() => {}}>`);

/** A child left inside `<style>`: the parent's next value would be CSS. Refused on the server too. */
define('ssr-lite-open', () => () => html`<div>${html`<style>`}${'b{color:red}'}</div>`);

/** A shadow component: served as a declarative shadow root. */
define({ tag: 'ssr-lite-shadow', shadow: 'open' }, () => () => html`<b>${'in'}</b>`);
