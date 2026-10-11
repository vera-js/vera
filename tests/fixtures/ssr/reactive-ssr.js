import { init, html, createStore, ref, shallowRef } from '@verajs/core';
export default class ReactiveSsr extends HTMLElement {
  connectedCallback() {
    init({ host: this, shadow: 'open' }, () => {
      const store = createStore({ list: [1, 2], nested: { deep: 'd' }, tags: new Set(['a']), map: new Map([['k', 'v']]) });
      const count = ref(0);
      const rows = shallowRef([{ id: 1 }]);
      count.value = 5;
      store.list.push(3);
      store.tags.add('b');
      return () => html`<p>${store.list.join(',')}|${store.nested.deep}|${[...store.tags].join('')}|${store.map.get('k')}|${count.value}|${rows.value.length}</p>`;
    });
  }
}
customElements.define('reactive-ssr', ReactiveSsr);
