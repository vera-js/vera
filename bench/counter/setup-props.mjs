// threadrace setup form, NODE ONLY (jsdom): the props-delivery path. Each op renders 10 fresh components with three
// `.prop` bindings into a fresh host (creation: the record drained by `adopt`), then updates all three (deliveries to
// the adopted accessors through `adoptProperty`). The arm's entry module re-exports core, renderer and spread.
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame'])
  globalThis[k] = dom.window[k];

let defined = false;
export const setup = ({ html, init, wire, flush, renderer, renderInto }) => {
  wire([renderer]);
  if (!defined) {
    customElements.define('pd-row', class extends HTMLElement {
      connectedCallback() { init(this, () => () => html`<i>${this.a}${this.b}${this.c}</i>`); }
    });
    defined = true;
  }
  const row = (a, b, c) => html`<pd-row .a=${a} .b=${b} .c=${c}></pd-row>`;
  const list = (k) => html`${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => row(k + i, 'x', i))}`;
  let rendered = 0, k = 0;
  return {
    work: (n) => {
      for (let i = 0; i < n; i++, k++) {
        const host = document.createElement('div');
        document.body.append(host);
        renderInto(list(k), host);
        flush();
        renderInto(list(k + 1), host);
        flush();
        rendered += host.querySelectorAll('pd-row').length;
        host.remove();
      }
    },
    ok: () => rendered === k * 10 && document.querySelector('pd-row') === null,
  };
};
