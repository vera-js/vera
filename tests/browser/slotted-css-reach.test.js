/**
 * **The published claim that `::slotted()` cannot reach a descendant of slotted content.**
 *
 * The README pitches light-DOM slots partly on this: a component's own stylesheet can style
 * `[slot='title'] em` in light mode, and there is no shadow spelling that does the same, because
 * `::slotted()` matches only the top-level assigned node. `CLAUDE.md` requires every public claim
 * to be measured and reproducible, and this one is about selector matching — which the platform
 * decides, so it belongs in a real browser rather than under jsdom.
 *
 * Three spellings are tried, because the claim is "there is no way to express it" rather than "the
 * obvious way fails": the descendant form, a compound argument, and a doubled `::slotted`. All
 * three must miss. The control is the half that keeps this from being vacuous — `::slotted(h3)` on
 * the top-level assigned node DOES apply, proving the stylesheet is live and adopted; without it a
 * typo in the `<style>` would produce three passing assertions and no styling at all.
 *
 * The light half asserts selector semantics, not framework behaviour: in light DOM the distributed
 * node is an ordinary descendant of the host, so an ordinary descendant selector reaches it. That
 * is the whole of the advantage, and it needs no framework to demonstrate.
 */
import { expect } from '@esm-bundle/chai';

customElements.define(
  'reach-card',
  class extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML =
        `<style>
           ::slotted(*) em      { outline: 3px solid rgb(1, 2, 3) }
           ::slotted(h3 em)     { outline: 3px solid rgb(1, 2, 3) }
           ::slotted(*) ::slotted(em) { outline: 3px solid rgb(1, 2, 3) }
           ::slotted(h3)        { outline: 3px solid rgb(4, 5, 6) }
         </style><div class="box"><slot name="t"></slot></div>`;
    }
  }
);

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const mount = (html) => {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  document.body.appendChild(holder);
  made.push(holder);
  return holder;
};

it('CONTROL: ::slotted() does style the top-level assigned node', () => {
  const holder = mount('<reach-card><h3 slot="t">plain</h3></reach-card>');
  expect(getComputedStyle(holder.querySelector('h3')).outlineColor).to.equal('rgb(4, 5, 6)');
});

it('but no ::slotted() spelling reaches a DESCENDANT of slotted content', () => {
  const holder = mount('<reach-card><h3 slot="t">has <em class="target">nested</em></h3></reach-card>');
  expect(
    getComputedStyle(holder.querySelector('.target')).outlineColor,
    'a descendant of assigned content is unreachable from a shadow stylesheet'
  ).to.equal('rgb(0, 0, 0)');
});

it('in light DOM an ordinary descendant selector reaches it', () => {
  const holder = mount(
    `<style>.light-host [slot='t'] em { outline: 3px solid rgb(7, 8, 9) }</style>
     <div class="light-host"><h3 slot="t">has <em class="target">nested</em></h3></div>`
  );
  expect(getComputedStyle(holder.querySelector('.target')).outlineColor).to.equal('rgb(7, 8, 9)');
});
