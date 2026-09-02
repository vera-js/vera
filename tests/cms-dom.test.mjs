/**
 * The DOM builder, held against its string twin. The load-bearing suite is the DIFFERENTIAL: both
 * serializers encode the same decisions (tight lists, `language-*`, the html-node sink), so for a
 * corpus of documents, parsing `serializeHtml`'s output must yield the same DOM the builder
 * constructs directly. A divergence is a bug in whichever one moved — the two-implementations
 * hazard this package accepted knowingly, held by a test instead of by hope.
 *
 * Comparison is structural, after normalizing the one cosmetic difference: the string form joins
 * blocks with newlines the builder has no reason to create, so whitespace-only text nodes between
 * elements are dropped (never inside `pre`, where whitespace is content).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const { parseMarkdown, serializeHtml, buildDom } = await load('cms/content');

const dom = new JSDOM('<!doctype html><body></body>');
const document = dom.window.document;

/**
 * Drop the string form's cosmetic newlines: whitespace-only text nodes between elements, and a
 * text node's trailing whitespace where an element follows (a list item's `two\n<ul>`). Both
 * collapse identically in a browser; neither is structure. Never inside `pre`, where whitespace
 * IS content.
 */
const normalize = (node) => {
  if (node.nodeName === 'PRE') return;
  for (const child of [...node.childNodes]) {
    if (child.nodeType === 3) {
      if (child.nextSibling === null || child.nextSibling.nodeType === 1)
        child.data = child.data.replace(/\s+$/, '');
      if (child.data === '') child.remove();
    } else {
      normalize(child);
    }
  }
};

const viaString = (root) => {
  const host = document.createElement('div');
  host.innerHTML = serializeHtml(root);
  normalize(host);
  return host;
};

const viaBuilder = (root) => {
  const host = document.createElement('div');
  host.append(buildDom(root, { document }));
  normalize(host);
  return host;
};

// ── the differential ────────────────────────────────────────────────────────────────────────────

const CORPUS = [
  '# Title\n\nA paragraph with *em*, **strong**, `code`, a [link](/u "t"), and ![alt](/i.png).',
  '- one\n- two\n  - nested\n- three with `code`\n\n1. a\n2. b',
  '3. starts at three\n4. four',
  '> quoted\n> # with a heading\n\n---\n\nafter the rule',
  '```js\nconst a = 1 < 2 && "x";\n```\n\n```\nno lang\n```',
  'Raw <mark data-x="1">inline</mark> html.\n\n<section class="wrap">\n  <p>block html</p>\n</section>',
  'A component: <vera-gallery album="trip"></vera-gallery> inline.\n\n<price-table currency="usd">\n</price-table>',
  'Escapes: a < b & "c" \\*literal\\*.\n\nsnake_case_names and 2 * 3.',
  '#### Deep heading ##\n\nline one\nline two joined.',
  /** Audit pass 2 additions: the fixed tag/emphasis/link shapes must agree in both serializers. */
  '***both*** and <span title="a>b">quoted</span> and [w](https://e.org/Foo_(bar)).',
  '<em>open <strong>nested</strong> across</em> markdown *after*.',
  /** Audit pass 8: `/>` on a non-void element does not close it in HTML — the twins must agree. */
  'a <x-y/>*em* text</x-y> b',
];

for (const source of CORPUS) {
  test(`differential: ${JSON.stringify(source.slice(0, 48))}…`, () => {
    const root = parseMarkdown(source);
    const built = viaBuilder(root);
    const parsed = viaString(root);
    assert.equal(
      built.innerHTML,
      parsed.innerHTML,
      'the DOM builder and the string serializer disagreed about the same tree'
    );
  });
}

// ── what the differential cannot show ───────────────────────────────────────────────────────────

test('structured nodes are built, not parsed — a marker-shaped title is text, byte for byte', () => {
  /** A string that would break if any structured content went through innerHTML. */
  const hostile = 'A title with <not-a-tag & "quotes"';
  const root = { type: 'root', children: [{ type: 'paragraph', children: [{ type: 'text', value: hostile }] }] };
  const host = viaBuilder(root);
  assert.equal(host.querySelector('p').textContent, hostile);
});

test('the html-node sink parses inertly — the fragment arrives, no script has run', () => {
  const root = parseMarkdown('<div><script>globalThis.__ranDuringBuild = true</script><b>kept</b></div>');
  const host = viaBuilder(root);
  assert.equal(dom.window.__ranDuringBuild, undefined, 'template parsing must not execute scripts');
  assert.equal(host.querySelector('b').textContent, 'kept');
  assert.ok(host.querySelector('script'), 'the author wrote a script tag; passing it through inert is the contract');
});

test('an explicit document wins over the global, so shims and jsdom both work', () => {
  const other = new JSDOM('<!doctype html>').window.document;
  const fragment = buildDom(parseMarkdown('# hi'), { document: other });
  assert.equal(fragment.firstChild.ownerDocument, other);
});

test('custom elements come through as elements, ready to upgrade on insertion', () => {
  const host = viaBuilder(parseMarkdown('see <vera-gallery album="trip"></vera-gallery> here'));
  const gallery = host.querySelector('vera-gallery');
  assert.equal(gallery.getAttribute('album'), 'trip');
});
