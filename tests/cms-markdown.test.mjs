/**
 * The markdown subset, asserted on the HTML it produces — parse and serialize together, because
 * the rendered string is the contract a site actually consumes and the most readable form for a
 * reviewer to check. AST-shape details are asserted only where the HTML cannot show them.
 *
 * Grouped: blocks, inline, the two documented sinks (raw HTML through untouched, everything else
 * escaped), the subset's deliberate exclusions, and the size cap.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { load, distUrl, isProduction } from './dist.mjs';

const { parseMarkdown, serializeHtml, parseContent } = await load('cms/publish');

const html = (source) => serializeHtml(parseMarkdown(source));

// ── blocks ──────────────────────────────────────────────────────────────────────────────────────

test('headings, ATX only, trailing hashes trimmed', () => {
  assert.equal(html('# One'), '<h1>One</h1>');
  assert.equal(html('###### Six ##'), '<h6>Six</h6>');
  assert.equal(html('####### Seven'), '<p>####### Seven</p>'); // seven #s is prose, as CommonMark says
  assert.equal(html('# C# is a language'), '<h1>C# is a language</h1>'); // no space, no strip — audit pass 2
});

test('paragraphs join their lines; blank lines separate them', () => {
  assert.equal(html('one\ntwo\n\nthree'), '<p>one\ntwo</p>\n<p>three</p>');
});

test('thematic breaks, and they win over list markers', () => {
  assert.equal(html('---'), '<hr>');
  assert.equal(html('- - -'), '<hr>');
  assert.equal(html('***'), '<hr>');
});

test('blockquotes nest blocks', () => {
  assert.equal(html('> # Quoted\n> and prose'), '<blockquote>\n<h1>Quoted</h1>\n<p>and prose</p>\n</blockquote>');
});

test('fenced code keeps its bytes exactly and names its language', () => {
  assert.equal(html('```js\nconst a = 1 < 2;\n```'), '<pre><code class="language-js">const a = 1 &lt; 2;</code></pre>');
  assert.equal(html('```\nplain\n```'), '<pre><code>plain</code></pre>');
});

test('a backtick-in-info fence line is prose in BOTH callers — it neither fences nor splits a paragraph', () => {
  /** interrupts() and parseBlocks once judged this line differently, splitting one paragraph in two — clean-streak pass 2. */
  assert.equal(html('text\n``` a`b\nmore'), '<p>text\n``` a`b\nmore</p>');
});

test('an unclosed fence runs to the end instead of erroring — the author is mid-typing', () => {
  assert.equal(html('```\nstill typing'), '<pre><code>still typing</code></pre>');
});

test('unordered and ordered lists, with start honored', () => {
  assert.equal(html('- a\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(html('3. c\n4. d'), '<ol start="3">\n<li>c</li>\n<li>d</li>\n</ol>');
});

test('list items hold nested blocks; a lone paragraph gets no <p> wrapper', () => {
  assert.equal(
    html('- outer\n  - inner\n- next'),
    '<ul>\n<li>outer\n<ul>\n<li>inner</li>\n</ul></li>\n<li>next</li>\n</ul>'
  );
});

test('a lesser-indented line after a blank ends the list', () => {
  assert.equal(html('- a\n\nprose'), '<ul>\n<li>a</li>\n</ul>\n<p>prose</p>');
});

test('a blank line between sibling items stays one list — audit pass 8', () => {
  assert.equal(html('- a\n\n- b'), '<ul>\n<li>a</li>\n<li>b</li>\n</ul>');
  assert.equal(html('1. a\n\n2. b'), '<ol>\n<li>a</li>\n<li>b</li>\n</ol>');
});

test('a thematic break inside a list ends it, exactly as at top level — audit pass 8', () => {
  assert.equal(html('- a\n- - -\n- b'), '<ul>\n<li>a</li>\n</ul>\n<hr>\n<ul>\n<li>b</li>\n</ul>');
});

test('only `1.` interrupts a paragraph — a wrapped year stays prose — audit pass 8', () => {
  assert.equal(html('I was born in\n1984. It was a cold year.'), '<p>I was born in\n1984. It was a cold year.</p>');
  assert.equal(html('watch:\n1. this interrupts'), '<p>watch:</p>\n<ol>\n<li>this interrupts</li>\n</ol>');
  assert.equal(html('and:\n- so does a bullet'), '<p>and:</p>\n<ul>\n<li>so does a bullet</li>\n</ul>');
});

// ── inline ──────────────────────────────────────────────────────────────────────────────────────

test('emphasis and strong, both markers, nested', () => {
  assert.equal(html('*em* **strong** _em_ __strong__'), '<p><em>em</em> <strong>strong</strong> <em>em</em> <strong>strong</strong></p>');
  assert.equal(html('**bold with *nested* em**'), '<p><strong>bold with <em>nested</em> em</strong></p>');
});

test('***both*** is em wrapping strong — everyday authoring, not an adversarial nesting', () => {
  assert.equal(html('***both***'), '<p><em><strong>both</strong></em></p>');
  assert.equal(html('a ***b*** c'), '<p>a <em><strong>b</strong></em> c</p>');
});

test('snake_case_names survive; a * b stays arithmetic', () => {
  assert.equal(html('use snake_case_names here'), '<p>use snake_case_names here</p>');
  assert.equal(html('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
});

test('links and images, with optional titles and nested-bracket labels', () => {
  assert.equal(html('[text](/url)'), '<p><a href="/url">text</a></p>');
  assert.equal(html('[a [b] c](/u "t")'), '<p><a href="/u" title="t">a [b] c</a></p>');
  assert.equal(html('![alt words](/img.png)'), '<p><img src="/img.png" alt="alt words"></p>');
  /** The Wikipedia shape: balanced parens belong to the URL — audit pass 2. */
  assert.equal(html('[x](https://e.org/Foo_(bar))'), '<p><a href="https://e.org/Foo_(bar)">x</a></p>');
});

test('a quoted > inside an attribute stays inside its tag — audit pass 2', () => {
  assert.equal(html('a <span title="a>b">kept</span> c'), '<p>a <span title="a>b">kept</span> c</p>');
});

test('inline code protects its contents, and longer backtick runs contain backticks', () => {
  assert.equal(html('a `<b>` c'), '<p>a <code>&lt;b&gt;</code> c</p>');
  assert.equal(html('`` a`b ``'), '<p><code>a`b</code></p>');
});

test('backslash escapes make punctuation literal', () => {
  assert.equal(html('\\*not em\\* and \\[not a link\\](x)'), '<p>*not em* and [not a link](x)</p>');
});

// ── the two sinks, and everything that is not one ───────────────────────────────────────────────

test('text is escaped at the render boundary', () => {
  assert.equal(html('a < b & "c"'), '<p>a &lt; b &amp; &quot;c&quot;</p>');
});

test('attribute positions are escaped — a url cannot close its own tag', () => {
  assert.equal(html('[x](/u"q)'), '<p><a href="/u&quot;q">x</a></p>');
});

test('a malformed injection-shaped link does not parse at all — it degrades to escaped text', () => {
  /** A URL cannot contain a space, so the whole construct falls back to text and every byte is escaped. */
  assert.equal(html('[x](/u" onmouseover="alert(1))'), '<p>[x](/u&quot; onmouseover=&quot;alert(1))</p>');
});

test('raw HTML passes through untouched, inline and block — the documented sink', () => {
  assert.equal(html('before <mark data-x="1">kept</mark> after'), '<p>before <mark data-x="1">kept</mark> after</p>');
  assert.equal(html('<section class="wrap">\n  <h1>raw</h1>\n</section>'), '<section class="wrap">\n  <h1>raw</h1>\n</section>');
});

test('custom elements are just HTML — a component sits inline in prose', () => {
  assert.equal(html('see <vera-gallery album="trip"></vera-gallery> here'), '<p>see <vera-gallery album="trip"></vera-gallery> here</p>');
  assert.equal(html('<price-table currency="usd">\n</price-table>'), '<price-table currency="usd">\n</price-table>');
});

test('markdown inside an HTML block stays literal — the passthrough rule, kept visible', () => {
  assert.equal(html('<div>\n**not bold**\n</div>'), '<div>\n**not bold**\n</div>');
});

test('a lone < that is not a tag is text, and is escaped', () => {
  assert.equal(html('for x < 3 use y'), '<p>for x &lt; 3 use y</p>');
});

test('tag-shaped non-tags are text, not vanishing html — the scanner regression, audit pass 8', () => {
  assert.equal(html('See <https://en.wikipedia.org> now.'), '<p>See &lt;https://en.wikipedia.org&gt; now.</p>');
  assert.equal(html('compare a<b, c>d here'), '<p>compare a&lt;b, c&gt;d here</p>');
});

test('an unmatched backtick run is literal whole, and scanning resumes after it — audit pass 8', () => {
  assert.equal(html('x ``a` y'), '<p>x ``a` y</p>');
});

// ── deliberate exclusions: present as prose, never half-supported ───────────────────────────────

test('the excluded syntaxes read as text rather than misparse', () => {
  assert.equal(html('    indented code'), '<p>indented code</p>'); // no indented code blocks
  assert.equal(html('[ref][1]\n\n[1]: /url'), '<p>[ref][1]</p>\n<p>[1]: /url</p>'); // no reference links
  assert.equal(html('Setext\n======'), '<p>Setext\n======</p>'); // no setext headings
});

// ── the entries agree, and the size is pinned ───────────────────────────────────────────────────

test('content and publish expose the same parse surface today', async () => {
  const content = await load('cms/content');
  assert.equal(typeof content.parseMarkdown, 'function');
  assert.equal(typeof content.serializeHtml, 'function');
  assert.equal(typeof content.parseContent, 'function');
  assert.equal(content.serializeHtml(content.parseMarkdown('# same')), '<h1>same</h1>');
});

test('the whole pipeline in one call: file in, html out', () => {
  const { data, root } = parseContent('---\ntitle: Post\n---\n# Hi\n\n<vera-gallery></vera-gallery>');
  assert.equal(data.title, 'Post');
  assert.equal(serializeHtml(root), '<h1>Hi</h1>\n<vera-gallery></vera-gallery>');
});

test('size: the bundle stays under its cap', { skip: !isProduction && 'measures the production bundle' }, () => {
  /**
   * The whole entry gets a hard cap so growth is a decision, not a drift — the cap moves only with
   * a measurement in the commit that moves it. The ledger so far:
   *
   *   3,125 B at introduction — parser + frontmatter + serializer
   *   3,632 B adding the read path — `queryEntries` + `createReader` cost 512 B together
   *   4,345 B adding `buildDom` — 713 B, most of it the inline-fragment nesting reconstruction
   *   4,462 B adding `terms()` + `byUuid` — 117 B together
   *   4,702 B after audit passes 1–4 — boundary guards and the first parser fixes, 240 B
   *   5,080 B after audit passes 7–8 — the tag-grammar restoration, sibling-blank lists,
   *           `1.`-only interruption, depth caps, the retryable taxonomy cache, real date
   *           ranges: 378 B of fixes for defects two independent review passes proved with
   *           reproductions. Every byte here bought a corrected behavior.
   */
  const bytes = gzipSync(readFileSync(new URL(distUrl('cms/content')))).length;
  assert.ok(bytes < 5200, `vera-cms-content.min.js is ${bytes} B gzipped — over the 5200 B cap`);
});
