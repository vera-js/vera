/**
 * A component that renders itself, stopping at a depth the test chooses.
 *
 * This is the exact shape `MAX_DEPTH` exists for — `index.js` calls it "a component that renders
 * itself" — so the cap is exercised by the thing it guards rather than by a hand-built chain.
 *
 * The stop depth arrives through the environment because `renderToString` takes a URL and Node caches
 * the module: two renders of one file share an import, so the limit has to be read per render rather
 * than at module scope. Reading it in `connectedCallback` is what makes one fixture serve both sides
 * of the boundary. This file is Node-only by construction, like the rest of `@verajs/ssr`.
 */
import { init, render, html } from '@verajs/core';

class DeepNest extends HTMLElement {
  connectedCallback() {
    init(this, { mode: 'open' });
    const stop = Number(process.env.VERA_SSR_DEPTH ?? 0);
    const depth = Number(this.getAttribute('depth') ?? 0);
    render(() =>
      depth >= stop ? html`<span>leaf ${depth}</span>` : html`<deep-nest depth="${depth + 1}"></deep-nest>`
    );
  }
}

customElements.define('deep-nest', DeepNest);
export default DeepNest;
