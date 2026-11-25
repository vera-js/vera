/**
 * The page for `ssr-release`'s `marker` mode: a light host that renders a property-bound child into itself (so it
 * stores the serializer's stamped text and is recorded), and a prepared child appended into a box no render places (so
 * it stays pending). Neither is kept by the page; a WeakRef to each is.
 */
import { init, html } from '@verajs/core';

const refs = (globalThis.__markerRefs ??= []);

customElements.define('marker-kid-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<i>${this.rows?.join(',') ?? 'none'}</i>`);
  }
});

customElements.define('marker-light-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this }, () => () => html`<span><marker-kid-ssr .rows=${['a']}></marker-kid-ssr></span>`);
    /** CONTROL, read off the shim's own record: the host stores stamped text (the production build's form). */
    globalThis.__markerStamped ||= this._entries.some((entry) => typeof entry === 'string' && entry.includes('vera-ssr-'));
    refs.push(new WeakRef(this));
  }
});

export default class MarkerPage extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<marker-light-ssr></marker-light-ssr>`);
    const kid = document.createElement('marker-kid-ssr');
    kid.rows = ['b'];
    document.createElement('div').appendChild(kid);
    refs.push(new WeakRef(kid));
  }
}
customElements.define('marker-page-ssr', MarkerPage);
