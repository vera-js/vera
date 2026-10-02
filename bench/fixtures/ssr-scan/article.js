import { init, render, html } from '@verajs/core';
let seed = 7; const rnd = (n) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % n);
const words = 'lorem ipsum dolor sit-amet consectetur adipiscing elit sed do eiusmod tempor well-known'.split(' ');
const w = (n) => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');
const paras = Array.from({ length: 120 }, (_, i) => `${w(60)} — ${i}`);
class ArtKid extends HTMLElement { connectedCallback() { init(this, { mode: 'open' }); render(() => html`<b>kid</b>`); } }
customElements.define('art-kid', ArtKid);
class ArtPage extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<article><h1 class="title-main">${w(5)}</h1>${paras.map((p) => html`<p class="para-text">${p} <a href="/x-y/${p.length}" title="see-also">${w(2)}</a></p>`)}<art-kid></art-kid></article>`);
  }
}
customElements.define('art-page', ArtPage);
export default ArtPage;
