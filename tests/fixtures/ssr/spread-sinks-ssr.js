import { init, render, html } from '@verajs/core';
import { spread } from '@verajs/renderer/spread';

/**
 * The hostile props bag, alone in its own fixture — grafting it onto `spread-ssr.js` changed the
 * template shape that file's hydration test adopts against, and the mismatch read as a regression
 * in an unrelated decision. One concern per fixture, exactly as per source file.
 */
export default class SpreadSinksSsr extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(
      () => html`<p class="sinks" ${spread({
        title: 'kept',
        srcdoc: '<script>1</script>',
        onclick: 'alert(1)',
        '.innerHTML': '<b>pwn</b>',
      })}>safe</p><p class="names" ${spread({
        'data-sane': 'kept',
        'a b': 'sp',
        'a=b': 'eq',
        'a"b': 'qu',
        'a>b': 'gt',
        'data-x="1" onmouseover="alert(2)" y': 'inj',
        'a\u0003b': 'ctl',
        '': 'empty',
      })}>named</p>`
    );
  }
}
customElements.define('spread-sinks-ssr', SpreadSinksSsr);
