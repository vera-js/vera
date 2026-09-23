/**
 * The namespace feature's central safety claim, on real engines.
 *
 * Everything this feature refuses, it refuses because **a custom element in the SVG namespace never
 * upgrades** — upgrade is spec-gated on the HTML namespace, so such an element has the right tag
 * name, no class, no `connectedCallback`, and nothing to search for. That claim is cited in the
 * compiler, the changeset and two suites, and it was held by nothing that runs: `CLAUDE.md` names
 * custom-element upgrade timing as precisely the class where "a pass under emulation is weak
 * evidence", and a jsdom probe is the emulation.
 *
 * The other half is the same story from the drawing side — an SVG element built as HTML is an
 * `HTMLUnknownElement` with no geometry, which is the bug an app reported as its entire icon set
 * vanishing. `getTotalLength()` exists only on a real `SVGPathElement`, so it is the one assertion
 * that cannot pass by accident.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html, svg } from '../../packages/core/dist/development/vera.js';
import { SVG_ICON_HTML } from './fixtures/hello-ssr.html.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const upgraded = [];
class Badge extends HTMLElement {
  connectedCallback() {
    upgraded.push(this.namespaceURI);
  }
}
customElements.define('ns-badge', Badge);

const into = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
};

it('an SVG-namespaced custom element never upgrades, and an HTML-namespaced one does', () => {
  const container = into();
  upgraded.length = 0;
  renderInto(html`<svg viewBox="0 0 24 24"><g>${svg`<ns-badge></ns-badge>`}</g></svg>`, container);
  const inSvg = container.querySelector('ns-badge');

  expect(inSvg, 'the element is in the DOM either way').to.not.equal(null);
  expect(inSvg.namespaceURI, 'and it really is SVG-namespaced').to.equal(SVG_NS);
  expect(inSvg instanceof Badge, 'so the class never attaches').to.equal(false);
  expect(upgraded, 'and connectedCallback never runs — silently, which is the whole problem').to.deep.equal([]);

  /**
   * CONTROL, and the remedy the renderer's warning actually recommends: the same element inside an
   * HTML integration point. Without this the assertion above passes just as well when nothing
   * rendered at all.
   */
  const island = into();
  upgraded.length = 0;
  renderInto(
    html`<svg viewBox="0 0 24 24"><foreignObject>${html`<ns-badge></ns-badge>`}</foreignObject></svg>`,
    island
  );
  const inIsland = island.querySelector('ns-badge');
  expect(inIsland.namespaceURI, '<foreignObject> content is HTML').to.equal(HTML_NS);
  expect(inIsland instanceof Badge, 'so the class attaches').to.equal(true);
  expect(upgraded, 'and connectedCallback runs, in the HTML namespace').to.deep.equal([HTML_NS]);
});

it('an SVG shape built as HTML has no geometry, and built as SVG has', () => {
  const wrong = into();
  renderInto(html`<svg viewBox="0 0 24 24"><g>${html`<path d="M0 0h24"></path>`}</g></svg>`, wrong);
  const asHtml = wrong.querySelector('path');
  expect(asHtml.namespaceURI, 'an html`` template stays HTML wherever it lands').to.equal(HTML_NS);
  expect(typeof asHtml.getTotalLength, 'so it is an HTMLUnknownElement — no geometry at all').to.equal(
    'undefined'
  );

  const right = into();
  renderInto(html`<svg viewBox="0 0 24 24"><g>${svg`<path d="M0 0h24"></path>`}</g></svg>`, right);
  const asSvg = right.querySelector('path');
  expect(asSvg.namespaceURI, 'CONTROL: the svg`` spelling is the fix').to.equal(SVG_NS);
  expect(asSvg.getTotalLength(), 'and it is a real SVGPathElement that measures').to.be.greaterThan(0);
});

/**
 * The integration points, from the runtime's side — `foreignHost` treats exactly these three as
 * HTML, and the compiler's one list matches it. A `<title>` holding markup inside an `<svg>` is the
 * platform behaviour the shared raw-text rule is knowingly wrong about, so it is worth pinning on
 * real parsers rather than trusting the note about it.
 */
it('svg <title>, <desc> and <foreignObject> hold HTML content, in every engine', () => {
  const container = into();
  container.innerHTML = '<svg><title><b>t</b></title><desc><i>d</i></desc><foreignObject><u>f</u></foreignObject></svg>';
  for (const [host, child] of [
    ['title', 'b'],
    ['desc', 'i'],
    ['foreignObject', 'u'],
  ]) {
    const element = container.querySelector(`${host} ${child}`);
    expect(element, `<${host}> parses its content as markup, not text`).to.not.equal(null);
    expect(element.namespaceURI, `and that markup is HTML inside <${host}>`).to.equal(HTML_NS);
  }
});

/**
 * **The server→client handoff for an icon, and a deliberate statement of what it does NOT prove.**
 *
 * This assertion passes whether the children were tagged `` svg`…` `` or `` html`…` ``, and that is
 * worth saying out loud rather than letting a future reader assume it covers the upgrade. Measured:
 * `serializeTemplate` emits BYTE-IDENTICAL markup for both, because `@verajs/ssr` writes a
 * template's STRINGS and the browser's own parser assigns namespaces from the markup's structure —
 * everything inside a serialised `<svg>` is SVG however it was built. **The compile-time tag has no
 * effect on the SSR path at all**; it decides what `createElementNS` does on the CLIENT.
 *
 * So this pins the handoff, not the rule: the shape an app actually ships survives the server, a
 * real parser and declarative shadow DOM with its geometry and its accessible name intact. The one
 * place server and client genuinely diverge is an upgraded template landing in an HTML parent, which
 * is the compile-time limit the changeset states and accepts.
 *
 * `SVG_ICON_HTML` is real `@verajs/ssr` output, generated by `scripts/build-hydration-fixture.mjs`
 * and `--check`ed in the gate, not markup written here to match.
 */
it('an icon survives the server, a real parser and declarative shadow DOM', () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  /** `setHTMLUnsafe` is what turns declarative shadow DOM into a real shadow root. */
  host.setHTMLUnsafe(SVG_ICON_HTML);
  const root = host.querySelector('svg-icon-ssr').shadowRoot;

  const path = root.querySelector('path');
  expect(path, 'the server emitted the shape').to.not.equal(null);
  expect(path.namespaceURI, 'and the parser put it in the SVG namespace').to.equal(SVG_NS);
  expect(path.getTotalLength(), 'so it is a real SVGPathElement that measures').to.be.greaterThan(0);

  const title = root.querySelector('title');
  expect(title.namespaceURI, 'the vouched <title> is SVG too, not an HTML <title>').to.equal(SVG_NS);
  expect(title.textContent, 'and carries the accessible name').to.equal('Close');
  expect(root.querySelector('circle').namespaceURI, 'every shape in the group').to.equal(SVG_NS);
  host.remove();
});

/**
 * **In foreign content the parser puts every start tag in the ADJUSTED CURRENT NODE's namespace.**
 *
 * So a `<math>` written inside an `<svg>` is itself an SVG element, and so is everything under it —
 * which is why `@verajs/jsx` switches mode on `<svg>`/`<math>` only from HTML mode. That guard was
 * justified in a comment claiming three engines and held by nothing that ran; this is the claim.
 * It is a statement about the platform, not about the framework, so a jsdom probe is the wrong
 * instrument for it.
 */
it('a nested <math> inside an <svg> is SVG all the way down, in every engine', () => {
  const container = into();
  container.innerHTML = '<svg><math><mtext><b>x</b></mtext></math></svg>';
  expect(container.querySelector('math').namespaceURI, 'the nested <math> is SVG').to.equal(SVG_NS);
  expect(container.querySelector('mtext').namespaceURI, 'and so is its <mtext>').to.equal(SVG_NS);

  /** CONTROL: from HTML mode a `<math>` really does switch, or the assertion above proves nothing. */
  const top = into();
  top.innerHTML = '<math><mtext><b>x</b></mtext></math>';
  expect(top.querySelector('math').namespaceURI, 'a top-level <math> is MathML').to.equal(MATHML_NS);
  expect(top.querySelector('mtext').namespaceURI, 'and its <mtext> too').to.equal(MATHML_NS);
  expect(top.querySelector('b').namespaceURI, '<mtext> is a text integration point').to.equal(HTML_NS);
});
