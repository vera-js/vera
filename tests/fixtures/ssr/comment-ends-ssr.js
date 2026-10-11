import { init, html } from '@verajs/core';

/** A component the nested-component scan must find AFTER an abruptly closed comment, and after a `--!>` one. */
class CommentChild extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<i>child rendered</i>`;
    });
  }
}
customElements.define('comment-child', CommentChild);

class CommentPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      return () => html`<p><!--><comment-child></comment-child></p><p><!-- a --!><comment-child></comment-child></p>`;
    });
    /** The server DOM's own parser, through innerHTML: its comment rule is the same one. */
    const parsed = document.createElement('div');
    parsed.innerHTML = '<!-->a<!--->b<!-- c --!>d';
    this.dataset.parsed = [...parsed.childNodes].map((node) => `${node.nodeType}:${node.nodeValue ?? node.textContent}`).join('|');
  }
}
customElements.define('comment-page', CommentPage);
export default CommentPage;
