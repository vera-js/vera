import { init, html } from '@verajs/core';

/** Adopts document sheets three ways and records what it saw — see `tests/ssr-document-adopted-sheets.test.mjs`. */
class AdoptedSheetsPage extends HTMLElement {
  connectedCallback() {
    init(this, () => {
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
      /** A sheet adopted empty, then filled: its CSS is served. */
      const late = new CSSStyleSheet();
      document.adoptedStyleSheets.push(late);
      late.replaceSync('.late { color: purple }');
      /** What the platform takes as a sequence, on the document and on a shadow root alike. */
      const outcome = (target, value) => {
        try {
          target.adoptedStyleSheets = value;
          return 'accepted';
        } catch (error) {
          return error.constructor.name;
        }
      };
      const root = document.createElement('div').attachShadow({ mode: 'open' });
      seen.sequences = [document, root].map((target) => [
        outcome(target, new Set([sheet('.s {}')])),
        outcome(target, (function* () {
          yield sheet('.g {}');
        })()),
        outcome(target, { length: 1, 0: sheet('.l {}') }),
        outcome(target, sheet('.lone {}')),
        outcome(target, '.str {}'),
      ]);
      seen.fromSet = root.adoptedStyleSheets.length;
      document.adoptedStyleSheets = [...document.adoptedStyleSheets.filter((each) => each !== late), late];
      return () => html`<p>sheets</p>`;
    });
  }
}
customElements.define('adopted-sheets-page', AdoptedSheetsPage);
export default AdoptedSheetsPage;
