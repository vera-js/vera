globalThis.__concurrentLoads = (globalThis.__concurrentLoads ?? 0) + 1;
customElements.define('probe-concurrent', class extends HTMLElement { connectedCallback() { this.textContent = 'concurrent-live'; } });
