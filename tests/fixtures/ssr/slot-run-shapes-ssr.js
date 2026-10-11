/** Run shapes an outer template binds into a light-slot component (hydration's R1 pins) — one module, chosen by `tag`. */
import { init, html } from '@verajs/core';

class SlotShapeInner extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => html`<div class="box"><slot name="t">T</slot><slot>FB</slot></div>`;
    });
  }
}
customElements.define('slot-shape-inner', SlotShapeInner);

const shape = (tag, draw) =>
  customElements.define(
    tag,
    class extends HTMLElement {
      connectedCallback() {
        init(this, () => {
          const view = draw;
          return typeof view === 'function' ? view : () => view;
        });
      }
    }
  );
/** Two runs among statics. */
shape('slot-mixed-ssr', () => html`<p>outer</p><slot-shape-inner><em>first</em>${['a1', 'a2'].map((x) => html`<i>${x}</i>`)}<u slot="t">mid</u>${['b1'].map((x) => html`<s>${x}</s>`)}<em>last</em></slot-shape-inner>`);
/** Each item TWO elements — a shape the first release of runs declines. */
shape('slot-pairs-ssr', () => html`<p>outer</p><slot-shape-inner>${['a', 'b'].map((x) => html`<i>${x}</i><b>${x}</b>`)}</slot-shape-inner>`);
/** A run's anchor inside text the walk split (`A`, a value, `B`, then the run): declined. */
shape('slot-split-ssr', () => html`<p>outer</p><slot-shape-inner>A${'t'}B${['a'].map((x) => html`<i>${x}</i>`)}</slot-shape-inner>`);
/** Text and a value directly before a run, and text right after one. */
shape('slot-textrun-ssr', () => html`<p>outer</p><slot-shape-inner>A${'t'}${['a'].map((x) => html`<i>${x}</i>`)}B</slot-shape-inner>`);
/** A run alone in the default slot, the named slot empty. */
shape('slot-plainrun-ssr', () => html`<p>outer</p><slot-shape-inner>${['a'].map((x) => html`<i>${x}</i>`)}</slot-shape-inner>`);
/** An EMPTY run between two static texts: the server merges them (`AB`), so the walk stands inside text when the run begins. */
shape('slot-emptyrun-ssr', () => html`<p>outer</p><slot-shape-inner>A${[].map((x) => html`<i>${x}</i>`)}B</slot-shape-inner>`);
