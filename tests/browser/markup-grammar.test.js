/**
 * Which elements are void, asked of the engines that decide it.
 *
 * Four files in this repo hold that fact (`@verajs/shared-utils` canonically, plus copies in
 * `@verajs/ssr` and `@verajs/renderer` that cannot import it). `tests/markup-grammar-homes.test.mjs`
 * keeps those copies agreeing with EACH OTHER — but every copy in a repo can agree and every one of
 * them be wrong, and no amount of cross-checking inside the repo can see that. This is the check
 * that can: it asks Chromium, Firefox and WebKit.
 *
 * **Why the list is not simply derived at build time**, since that is the obvious question: the DOM
 * can verify a candidate but cannot enumerate the set — there is no API that hands you the void
 * elements — so generation would still need a candidate list, which is the list we are trying not
 * to maintain. And the generator would have to be jsdom, which is the one thing this repo will not
 * make an oracle for a platform fact. Measured, jsdom answers that `keygen`, `basefont` and `frame`
 * ARE void and `menuitem` is not: an era's answer, baked in. So the constant stays hand-written and
 * the ENGINES check it, which is the arrangement `./spread-names.test.js` already uses for
 * attribute names.
 *
 * The oracle is the serializer: an element with no end tag serializes without one.
 */
import { expect } from '@esm-bundle/chai';

/** THE SPEC, stated here and imported from nothing — the whole point is to check the constant. */
const VOID = [
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
];

/**
 * Every element HTML defines. Completeness is only testable over a universe, and the platform
 * offers no way to enumerate one — so this is the universe, and an element added to HTML after it
 * was written is the gap, named rather than left implicit.
 */
const ALL_ELEMENTS = [
  'a', 'abbr', 'address', 'area', 'article', 'aside', 'audio', 'b', 'base', 'bdi', 'bdo', 'blockquote',
  'body', 'br', 'button', 'canvas', 'caption', 'cite', 'code', 'col', 'colgroup', 'data', 'datalist',
  'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'embed', 'fieldset', 'figcaption',
  'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hgroup', 'hr',
  'html', 'i', 'iframe', 'img', 'input', 'ins', 'kbd', 'label', 'legend', 'li', 'link', 'main', 'map',
  'mark', 'menu', 'meta', 'meter', 'nav', 'noscript', 'object', 'ol', 'optgroup', 'option', 'output',
  'p', 'param', 'picture', 'pre', 'progress', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'script', 'search',
  'section', 'select', 'slot', 'small', 'source', 'span', 'strong', 'style', 'sub', 'summary', 'sup',
  'table', 'tbody', 'td', 'template', 'textarea', 'tfoot', 'th', 'thead', 'time', 'title', 'tr',
  'track', 'u', 'ul', 'var', 'video', 'wbr',
];

const isVoid = (tag) => !document.createElement(tag).outerHTML.endsWith(`</${tag}>`);

it('this engine agrees about exactly which elements are void', () => {
  const engineSays = ALL_ELEMENTS.filter(isVoid);
  /** NON-ZERO CONTROL: an engine answering "none" means the oracle broke, not that nothing is void. */
  expect(engineSays.length, 'the oracle returned nothing — it is measuring nothing').to.be.greaterThan(0);
  expect(engineSays.slice().sort().join(','), 'the engine\'s void set').to.equal(VOID.slice().sort().join(','));
});

/**
 * The consequence, rather than the classification — because the constant exists to prevent exactly
 * these two DOM shapes, and an engine could in principle agree about `outerHTML` while parsing
 * differently. Both were live in this repo until 2026-09-12.
 */
it('a non-void element written self-closing swallows its next sibling, in this engine', () => {
  const host = document.createElement('div');
  host.innerHTML = '<div/><span>after</span>';
  const span = host.querySelector('span');
  expect(span, 'the span exists either way').to.not.equal(null);
  expect(span.parentElement.localName, 'JSX means empty; HTML means open').to.equal('div');

  /** CONTROL: written correctly, the span is a sibling. */
  host.innerHTML = '<div></div><span>after</span>';
  expect(host.querySelector('span').parentElement, 'the corrected form').to.equal(host);
});

it('a void element written with an end tag renders twice, in this engine', () => {
  const host = document.createElement('div');
  host.innerHTML = '<br></br>';
  expect(host.querySelectorAll('br').length, '</br> is read as another <br>').to.equal(2);

  /** CONTROL: written correctly, one. */
  host.innerHTML = '<br>';
  expect(host.querySelectorAll('br').length, 'the corrected form').to.equal(1);
});

/**
 * Foreign content is the exception both rules turn on, and it is why the renderer's diagnostic
 * tracks `<svg>`/`<math>` depth rather than scanning tag shapes alone.
 */
it('inside <svg>, self-closing IS honoured — the exception the diagnostic depends on', () => {
  const host = document.createElement('div');
  host.innerHTML = '<svg><circle/><rect/></svg>';
  const svg = host.querySelector('svg');
  expect(svg.children.length, 'two siblings, not a nest').to.equal(2);
  expect(svg.querySelector('rect').parentElement.localName, 'rect is not inside circle').to.equal('svg');
});
