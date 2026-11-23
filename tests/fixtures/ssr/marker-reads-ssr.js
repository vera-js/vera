/**
 * A component that builds a child component, hands it a property, and writes into its own markup what DOM reads say
 * about that child: its attribute names, its parent's `innerHTML`, its `outerHTML`, `hasAttributes()` and the
 * attribute count, the list's item and named access, a deep clone's reads, and equality with a twin (a show-source or
 * debug component does this). Built for `tests/ssr-instance-marker-reads.test.mjs`.
 */
import { init, html } from '@verajs/core';

customElements.define('marker-kid-ssr', class extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => () => html`<i>${this.rows?.join(',') ?? 'none'}</i>`);
  }
});

customElements.define('marker-reads-ssr', class extends HTMLElement {
  connectedCallback() {
    const kid = document.createElement('marker-kid-ssr');
    kid.rows = ['a', 'b'];
    kid.setAttribute('data-x', '1');
    const holder = document.createElement('div');
    holder.appendChild(kid);
    const bare = document.createElement('marker-kid-ssr');
    const lone = document.createElement('div');
    lone.appendChild(bare);
    /** What the rest of the attribute surface says: the list's length, item and named access, a deep clone, equality. */
    const twin = document.createElement('marker-kid-ssr');
    twin.setAttribute('data-x', '1');
    const clone = kid.cloneNode(true);
    const list = kid.attributes;
    const more = [list.length, list[0]?.name, String(list.getNamedItem('data-x')?.value), String(kid.isEqualNode(twin)), clone.getAttributeNames().join(' '), clone.outerHTML.includes('vera-ssr-')].join(' ');
    init({ host: this, shadow: 'open' }, () => () => html`<p class="more">${more}</p><p class="names">${kid.getAttributeNames().join(' ')}</p><p class="inner">${holder.innerHTML}</p><p class="outer">${kid.outerHTML}</p><p class="has">${String(kid.hasAttributes())} ${kid.attributes.length} ${String(bare.hasAttributes())} ${bare.attributes.length}</p>`);
    this.shadowRoot.appendChild(holder);
    this.shadowRoot.appendChild(lone);
  }
});
