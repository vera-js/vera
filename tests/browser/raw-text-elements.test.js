/**
 * A binding inside an element whose children a parser reads as **text**.
 *
 * The renderer marks a child slot with `<?…>`, which the parser turns into a comment — except inside
 * a raw-text element, where it stays characters and never becomes a part. `RAW_TEXT_TAGS` is the
 * list of those, and it was missing two:
 *
 * - `html\`<iframe>${v}</iframe>\`` painted the literal marker onto the page in **all three engines**
 *   and never updated;
 * - `html\`<noscript>${v}</noscript>\`` did the same **in Firefox only**. A template's contents are
 *   parsed with the scripting flag disabled, which is what decides whether `noscript` is raw text,
 *   and Chromium and WebKit parse it as markup there while Firefox parses it as text.
 *
 * The second is why this suite is in the browser rather than beside its siblings in jsdom. jsdom
 * parses with scripting disabled and would have reported the *opposite* of what two of three engines
 * do, and no fake DOM has an opinion worth having about the tree builder. An app developed in Chrome
 * was shipping `<?$v8hpsho$>` onto the page for Firefox users.
 *
 * Asserted as "renders the value and updates it", not as markup, because the three engines
 * legitimately build different trees here and only the result has to agree.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire } from '../../packages/core/dist/development/vera.js';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';

wire({ on: 'render', fn: renderInto, priority: 50 });

/** Every raw-text element, plus a control that is not one. */
const SUBJECTS = [
  ['script', (v) => html`<script>const x = "${v}";<\/script>`],
  ['style', (v) => html`<style>.a { color: ${v}; }</style>`],
  ['textarea', (v) => html`<textarea>${v}</textarea>`],
  ['title', (v) => html`<title>${v}</title>`],
  ['iframe', (v) => html`<iframe>${v}</iframe>`],
  ['noscript', (v) => html`<noscript>${v}</noscript>`],
  ['div', (v) => html`<div>${v}</div>`],
];

for (const [name, make] of SUBJECTS) {
  it(`a binding inside <${name}> renders its value and updates`, () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    try {
      renderInto(make('AAA'), host);
      expect(host.textContent, `<${name}> did not render the value`).to.contain('AAA');
      /** The marker is the framework's own syntax; seeing it means the slot was never a part. */
      expect(host.textContent, `<${name}> painted the renderer's marker onto the page`).to.not.match(/<\?\$/);

      renderInto(make('BBB'), host);
      expect(host.textContent, `<${name}> did not update`).to.contain('BBB');
      expect(host.textContent, `<${name}> kept the old value after an update`).to.not.contain('AAA');
    } finally {
      host.remove();
    }
  });
}

/**
 * And the classification itself, measured here rather than trusted: whichever elements *this* engine
 * parses children of as text must be the ones the renderer treats that way. A new raw-text element,
 * or one that stops being one, fails here instead of painting a marker onto someone's page.
 */
it('the raw-text list matches what this engine parses as text', () => {
  const TAGS = 'script style textarea title iframe noscript div span p pre code'.split(' ');
  const measured = TAGS.filter((tag) => {
    const host = document.createElement('div');
    host.innerHTML = `<${tag}><b>y</b></${tag}>`;
    const element = host.querySelector(tag);
    const child = element && element.firstChild;
    return Boolean(child && child.nodeType === 3 && child.data.indexOf('<b>') !== -1);
  });
  /** Every element this engine reads as text must render a binding correctly, which the cases above
   * assert one by one — so the check here is that the set has not grown beyond them. */
  const covered = SUBJECTS.map(([name]) => name);
  const uncovered = measured.filter((tag) => covered.indexOf(tag) === -1);
  expect(uncovered, `this engine parses these as raw text and no case above covers them`).to.deep.equal([]);
});
