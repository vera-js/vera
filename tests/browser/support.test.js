import { expect } from '@esm-bundle/chai';

/** Records what this engine supports, so a skipped test is visible rather than silent. */
it('reports engine support for the features the suites depend on', () => {
  const support = {
    adoptedStyleSheets: 'adoptedStyleSheets' in document,
    replaceSync: typeof CSSStyleSheet.prototype.replaceSync === 'function',
    CSSScopeRule: typeof CSSScopeRule === 'function',
    declarativeShadowDOM: (() => {
      const d = document.createElement('div');
      d.setHTMLUnsafe?.('<x-dsd><template shadowrootmode="open"></template></x-dsd>');
      return d.firstElementChild?.shadowRoot != null;
    })(),
  };
  console.log('ENGINE SUPPORT: ' + JSON.stringify(support));
  expect(support.adoptedStyleSheets, 'adoptedStyleSheets').to.be.true;
  expect(support.replaceSync, 'replaceSync').to.be.true;
});
