/**
 * The component half of the RAWTEXT carriage-return check.
 *
 * A CR is written as an escape rather than a literal, for the reason `text-boundary-cases.js` gives:
 * a literal CR in a source file is invisible in a diff and normalised by half the tools that touch
 * it — including, in this case, git itself on a checkout that translates line endings, which would
 * make the fixture stop testing the thing it exists to test.
 */
import { init, render, html } from '@verajs/core';

export const CR = '\r';

customElements.define('t-rawtext', class extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<div><style>a${CR}b</style><script>a${CR}b</script></div>`);
  }
});
