import { init, render, html } from '@verajs/core';

/** Adopts document sheets three ways and records what it saw — see `tests/ssr-document-adopted-sheets.test.mjs`. */
class AdoptedSheetsPage extends HTMLElement {
  connectedCallback() {
    init(this);
    const seen = (globalThis.__adopted = { before: document.adoptedStyleSheets.length, errors: [] });
    const sheet = (css) => {
      const made = new CSSStyleSheet();
      made.replaceSync(css);
      return made;
    };
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet('.a { color: red }'), sheet('.b { color: blue }')];
    document.adoptedStyleSheets.push(sheet('.c { color: green }'));
    seen.after = document.adoptedStyleSheets.length;
    for (const bad of [sheet('.d {}'), [{ cssText: '.e {}' }], null])
      try {
        document.adoptedStyleSheets = bad;
      } catch (error) {
        seen.errors.push(error.constructor.name);
      }
    seen.kept = document.adoptedStyleSheets.length;
    render(() => html`<p>sheets</p>`);
  }
}
customElements.define('adopted-sheets-page', AdoptedSheetsPage);
export default AdoptedSheetsPage;
