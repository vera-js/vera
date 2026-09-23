/**
 * `svg` and `mathml` — core's namespaced template tags.
 *
 * They existed in `store.ts` from the beginning and were never exported, so the renderer's support
 * for them was unreachable from core's public API: `@verajs/renderer` reads `_$litType$` and wraps
 * the markup in `<svg>` or `<math>` before parsing, precisely so the fragment lands in the right
 * namespace, but nothing in core produced those types. A user had to import lit-html's `svg` or
 * hand-craft `{ _$litType$: 2, strings, values }`.
 *
 * Namespace is the whole point. `document.createElement('circle')` makes an HTMLUnknownElement;
 * only a fragment parsed inside `<svg>` produces a real SVGCircleElement, and only that renders.
 */
import { load, isProduction } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];

const { html, svg, mathml } = await load('core');
const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

let host;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});

test('core exports both namespaced tags', () => {
  assert.equal(typeof svg, 'function');
  assert.equal(typeof mathml, 'function');
});

test('they produce distinct template types', () => {
  /** The renderer switches on this to decide the parsing context. */
  assert.equal(html``._$litType$, 1);
  assert.equal(svg``._$litType$, 2);
  assert.equal(mathml``._$litType$, 3);
});

test('an svg template renders into the SVG namespace', () => {
  renderInto(html`<svg viewBox="0 0 10 10">${svg`<circle cx="5" cy="5" r="4" />`}</svg>`, host);
  const circle = host.querySelector('circle');
  assert.ok(circle, 'the element exists');
  assert.equal(circle.namespaceURI, SVG_NS, 'and is a real SVG element, not HTMLUnknownElement');
});

test('bindings work inside an svg template', () => {
  renderInto(html`<svg>${svg`<circle cx=${5} r=${4} fill=${'red'} />`}</svg>`, host);
  const circle = host.querySelector('circle');
  assert.equal(circle.getAttribute('cx'), '5');
  assert.equal(circle.getAttribute('r'), '4');
  assert.equal(circle.getAttribute('fill'), 'red');
});

test('an svg template updates in place across renders', () => {
  const draw = (r) => renderInto(html`<svg>${svg`<circle r=${r} />`}</svg>`, host);
  draw(4);
  const first = host.querySelector('circle');
  draw(7);
  assert.equal(host.querySelector('circle'), first, 'the element was updated, not replaced');
  assert.equal(first.getAttribute('r'), '7');
});

test('a mathml template renders into the MathML namespace', () => {
  renderInto(html`<math>${mathml`<mi>${'x'}</mi>`}</math>`, host);
  const mi = host.querySelector('mi');
  assert.ok(mi, 'the element exists');
  assert.equal(mi.namespaceURI, MATHML_NS);
  assert.equal(mi.textContent, 'x', 'and its binding committed');
});

test('a plain html template stays in the HTML namespace', () => {
  /** The control: without the tag, the same markup is not namespaced. */
  renderInto(html`<div><span>plain</span></div>`, host);
  assert.equal(host.querySelector('span').namespaceURI, 'http://www.w3.org/1999/xhtml');
});

/**
 * **A mistake the tag system cannot prevent is NAMED rather than swallowed.**
 *
 * The tag above says the namespace outright. But it is chosen where a template is WRITTEN, which is
 * the wrong place when the template is handed across a function boundary:
 *
 *     const Frame = (children) => html`<svg viewBox="0 0 24 24">${children}</svg>`;
 *     Frame(html`<path d="M0 0h24"/>`)
 *
 * `` svg`…` `` was correct and the call site had no way to know — the destination belongs to the
 * callee, possibly a library. An app reported every header icon vanishing, silently, because an
 * `HTMLUnknownElement` named `path` has the right tag and no geometry. `@verajs/jsx` closes its own
 * half by tagging SVG-rooted templates at compile time; nothing can close a hand-written one.
 *
 * Inferring the namespace from the DOM parent instead was built and measured, and deliberately not
 * kept: a part resolves its position while still inside the off-document fragment it is built in,
 * so a mapped list or a fragment-rooted binding answered "not SVG" and cached it for the life of
 * the page — order-dependently, since an empty first render gave the other answer. Naming the
 * mistake costs nothing in production and cannot be wrong.
 */
test('an html template committed into <svg> or <math> is named in development', { skip: isProduction && 'dev-only diagnostic' }, () => {
  const seen = [];
  const nativeWarn = console.warn;
  console.warn = (...args) => seen.push(String(args[0]));
  try {
    const named = (tree) => {
      seen.length = 0;
      const local = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(local);
      renderInto(tree, local);
      return seen.filter((w) => w.includes('will not render'));
    };

    const svgWarnings = named(html`<svg viewBox="0 0 24 24">${html`<path d="M0 0h24"></path>`}</svg>`);
    assert.equal(svgWarnings.length, 1, 'the mistake is named exactly once');
    assert.ok(svgWarnings[0].startsWith('[vera] renderer:'), 'and carries the prefix every diagnostic has');
    assert.ok(svgWarnings[0].includes('<path>'), 'naming the element, so it is found without a bisect');
    assert.equal(named(html`<math>${html`<mi>x</mi>`}</math>`).length, 1, 'MathML is the same mistake');

    /** CONTROLS: correct usage, and the integration points where HTML content is RIGHT. */
    assert.equal(named(html`<svg>${svg`<path d="M0 0h24"></path>`}</svg>`).length, 0, 'CONTROL: svg`` is correct');
    assert.equal(named(html`<math>${mathml`<mi>x</mi>`}</math>`).length, 0, 'CONTROL: mathml`` is correct');
    assert.equal(
      named(html`<svg><foreignObject>${html`<div>ok</div>`}</foreignObject></svg>`).length,
      0,
      'CONTROL: <foreignObject> is an HTML integration point — HTML inside it is right'
    );
    assert.equal(
      named(html`<math><mtext>${html`<b>ok</b>`}</mtext></math>`).length,
      0,
      'CONTROL: <mtext> is a MathML text integration point, likewise'
    );
    assert.equal(named(html`<div>${html`<p>plain</p>`}</div>`).length, 0, 'CONTROL: ordinary HTML');
    assert.equal(
      named(html`<svg>${html`<style>circle{fill:red}</style>`}</svg>`).length,
      0,
      'CONTROL: <style> and <script> never draw, so "will not render" is the wrong complaint — and an ' +
        'HTML <style> inside an <svg> applies its rules perfectly well'
    );

    /**
     * A component's children arrive as an ARRAY and reach the DOM through the LIST path, not the
     * single-child commit — the most likely spelling of the bug this exists for, and one an earlier
     * draft could never see.
     *
     * **`<rect>`, not `<path>`, and that is load-bearing.** The diagnostic is deduped per
     * host-and-tag pair for the life of the module, so a tag any assertion above already used is
     * spent: reusing `<path>` here asserts `1` and measures `0`. A test for a deduped channel has
     * to bring its own key.
     */
    assert.equal(
      named(html`<svg>${[html`<rect width="1"></rect>`, html`<line x1="0"></line>`]}</svg>`).length,
      2,
      'a LIST of html`` fragments inside <svg> is named too — one per distinct tag, since a list ' +
        'commits each row separately and both are real mistakes worth naming'
    );
    assert.equal(
      named(html`<svg>${[html`<rect width="2"></rect>`, html`<line x1="2"></line>`]}</svg>`).length,
      0,
      'and a second list of the SAME tags says nothing: the dedupe is per host-and-tag, for the ' +
        'life of the module, not per insert'
    );

    /**
     * **A keyed list that gains two or more rows at once** batches them into a `DocumentFragment`
     * and lands them with one `insertBefore`, so the rows are created against something with no
     * namespace — a growing icon list, the shape this diagnostic most exists for, and one it
     * silently missed. `@verajs/renderer/keyed` imports nothing at runtime by design, so the
     * resolution happens in `$c`, which knows the part's real destination.
     */
    const grow = (rows) => html`<svg>${rows}</svg>`;
    const growHost = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(growHost);
    /**
     * **The seed row is rendered FIRST and its warnings discarded**, and the growth rows bring tags
     * the seed did not. Without both, this assertion cannot fail: the seed spends the pair, the
     * batched fill contributes nothing, and the one warning counted is the seed's — so the test
     * passes identically with the diagnostic removed. Verified against a patched build.
     */
    renderInto(grow([keyed('s', html`<samp>s</samp>`)]), growHost);
    seen.length = 0;
    renderInto(
      grow([keyed('s', html`<samp>s</samp>`), keyed('v', html`<var>v</var>`), keyed('w', html`<wbr>`)]),
      growHost
    );
    assert.equal(
      seen.filter((w) => w.includes('will not render')).length,
      2,
      'a keyed list growing by two at once names both new rows — they are batched into a fragment ' +
        'and landed with one insertBefore, so they were previously invisible to the diagnostic'
    );

    /**
     * **A keyed row that is a MULTI-ROOT template takes the third `$c` branch** — not the
     * single-`rootNode` fast path the rows above take, and not the array path below. It was
     * reachable and correct and exercised by nothing: deleting its `warnForeignMismatch` call left
     * both feature suites green.
     */
    const multi = (rows) => html`<svg>${rows}</svg>`;
    const multiHost = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(multiHost);
    renderInto(multi([keyed('s', html`<q1>a</q1><q2>b</q2>`)]), multiHost);
    seen.length = 0;
    renderInto(
      multi([keyed('s', html`<q1>a</q1><q2>b</q2>`), keyed('v', html`<q3>c</q3><q4>d</q4>`)]),
      multiHost
    );
    assert.equal(
      seen.filter((w) => w.includes('will not render')).length,
      2,
      'both roots of a multi-root keyed row are named — the branch commits an instance fragment, ' +
        'so every root in it is an offender in its own right'
    );

    /**
     * **A keyed row whose value is an ARRAY takes the OTHER batched path**, and it is the one
     * `ChildPart._foreignHost` exists for: the row's part is created against the batching
     * `DocumentFragment`, so the namespace has to come from where the list LANDS rather than from
     * the part's own parent. Replacing `this._foreignHost ?? parent` with `parent` takes this from
     * two warnings to ZERO and left every other assertion here green — a fragment has no namespace,
     * so the diagnostic simply decided the host was not foreign and said nothing.
     *
     * The keyed block above cannot reach it: a row holding a single template resolves in `$c`
     * instead, and that shape still warns under the same mutation.
     */
    const arrayRows = (rows) => html`<svg>${rows}</svg>`;
    const arrayHost = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(arrayHost);
    /** Seed first and discard, so the two counted warnings are the batched fill's own. */
    renderInto(arrayRows([keyed('a', [html`<z1>a</z1>`])]), arrayHost);
    seen.length = 0;
    renderInto(
      arrayRows([keyed('a', [html`<z1>a</z1>`]), keyed('b', [html`<z2>b</z2>`]), keyed('c', [html`<z3>c</z3>`])]),
      arrayHost
    );
    assert.equal(
      seen.filter((w) => w.includes('will not render')).length,
      2,
      'array-valued keyed rows batched into a fragment resolve against where the list lands'
    );

    /**
     * **A list part at the TOP LEVEL of its own template** — which is exactly what JSX `<>{items}</>`
     * compiles to — used to be silenced for the life of the page. `$c` records `_foreignHost` from
     * the list part's parent, and at that moment the part's markers are still in its own template's
     * `DocumentFragment`, not in an element; preferring that stored value unconditionally cached a
     * detached fragment, which has no namespace, so every later commit answered "not foreign".
     * `parent` is authoritative once it is a real element, so it is consulted first.
     *
     * The seed render is discarded and the counted rows bring unspent tags, or this cannot fail.
     */
    const topLevel = (rows) => html`${rows}`;
    const framed = (inner) => html`<svg><g>${inner}</g></svg>`;
    const topHost = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(topHost);
    /**
     * The row starts as a STRING and becomes a template, so the row part commits through
     * `ChildPart._insert` — the seam that reads the stored host. Rows that are templates from the
     * first render resolve in `$c` instead and never touch it, which is why an earlier version of
     * this assertion passed with the defect present.
     */
    renderInto(framed(topLevel(['plain'])), topHost);
    seen.length = 0;
    renderInto(framed(topLevel([html`<z9>a</z9>`])), topHost);
    assert.equal(
      seen.filter((w) => w.includes('will not render')).length,
      1,
      'a top-level list part resolves against the element its markers actually sit in, not the ' +
        'fragment they were assembled in — and keeps doing so on every later commit'
    );

    /**
     * **Two offenders in ONE insert**, which is what the `continue` after warning exists for. The
     * list case above does not exercise it: a list commits each row separately, so each is its own
     * call. Found by mutation — swapping that `continue` back to `return` failed nothing.
     */
    assert.equal(
      named(html`<svg>${html`<u1>a</u1><u2>b</u2>`}</svg>`).length,
      2,
      'a multi-root template names every distinct offender in the same insert'
    );

    /**
     * **A SPENT pair must skip that node, not abandon the insert** — the other `continue`, and the
     * one the multi-root case above cannot reach, because neither of its tags was spent so the
     * dedupe branch never ran at all. Turning it into a `return` failed nothing until this existed:
     * the common shape is a list that keeps re-rendering a tag already named and gains a new one.
     */
    assert.equal(named(html`<svg>${html`<u30>a</u30>`}</svg>`).length, 1, 'seed: spends the <u30> pair');
    assert.equal(
      named(html`<svg>${html`<u30>a</u30><u31>b</u31>`}</svg>`).length,
      1,
      'a fresh offender behind a spent one is still named — a spent pair skips its own node only'
    );

    /**
     * **The remedy is chosen by the host's NAMESPACE, and the MathML wording is a different string.**
     * Only the COUNT was asserted before, so collapsing the ternary to the SVG branch passed
     * everything: a `<mrow>` host was told to use `<foreignObject>`, which does not exist in MathML
     * and draws nothing. The namespace decides and never the name — SVG owns `mask`, `marker`,
     * `mpath` and `metadata`, so a "starts with m" shortcut would misadvise four SVG hosts.
     */
    const svgAdvice = named(html`<svg><g>${html`<u32>x</u32>`}</g></svg>`);
    assert.equal(svgAdvice.length, 1, 'CONTROL: the SVG host is named at all');
    assert.ok(svgAdvice[0].includes('<foreignObject>'), 'an SVG host is sent to <foreignObject>');
    const mathAdvice = named(html`<math><mrow>${html`<u33>x</u33>`}</mrow></math>`);
    assert.equal(mathAdvice.length, 1, 'CONTROL: the MathML host is named at all');
    assert.ok(mathAdvice[0].includes('<mtext>'), 'a MathML host is sent to <mtext>, which exists there');
    assert.ok(
      !mathAdvice[0].includes('<foreignObject>'),
      'and never to <foreignObject>, which has no meaning inside <math>'
    );

    /**
     * **`<annotation-xml>` is read as attribute OR property, and for BOTH HTML encodings.** JSX
     * compiles that dash-named tag's `encoding` to a property with no attribute behind it, so the
     * hand-written and JSX spellings of identical markup disagreed about whether this is an
     * integration point. The attribute half was covered; removing the property half, or the
     * `application/xhtml+xml` arm, failed nothing.
     */
    assert.equal(
      named(html`<math><annotation-xml .encoding=${'text/html'}>${html`<u34>x</u34>`}</annotation-xml></math>`)
        .length,
      0,
      'the PROPERTY spelling makes it an integration point, exactly as the attribute does'
    );
    assert.equal(
      named(html`<math><annotation-xml .encoding=${'application/mathml+xml'}>${html`<u36>x</u36>`}</annotation-xml></math>`)
        .length,
      1,
      'CONTROL: any other encoding keeps the content MathML, property spelling included'
    );
    /**
     * `image/svg+xml` is MathML's own registered encoding for an SVG annotation — the one place SVG
     * inside a `<math>` subtree is the intended spelling. Treating it as foreign produced a warning
     * whose every clause was false, including advice to change the encoding to `text/html`.
     */
    assert.equal(
      named(html`<math><annotation-xml encoding="image/svg+xml">${svg`<u45>x</u45>`}</annotation-xml></math>`)
        .length,
      0,
      'an SVG annotation is the author saying exactly what they mean, and is left alone'
    );

    /**
     * **The dedupe is keyed by the host's NAMESPACE as well as its name.** `<a>` is a real element
     * in both — the parser leaves `<math><a>` in MathML, since `a` is not on the foreign-content
     * breakout list — so keying by name alone let an SVG `<a>` host spend the pair for a MathML one,
     * which then went silent AND lost the remedy chosen for its namespace.
     */
    const svgAnchor = named(html`<svg><a>${html`<u50>x</u50>`}</a></svg>`);
    assert.equal(svgAnchor.length, 1, 'an SVG <a> host is named');
    assert.ok(svgAnchor[0].includes('<foreignObject>'), 'with the SVG remedy');
    const mathAnchor = named(html`<math><a>${html`<u50>x</u50>`}</a></math>`);
    assert.equal(mathAnchor.length, 1, 'and a MathML <a> host is named too, not swallowed by the first');
    assert.ok(mathAnchor[0].includes('<mtext>'), 'with the MathML remedy, which is the point of keying on it');

    /**
     * **The mirror case, which a test for HTML specifically could never see.** A `` mathml`…` ``
     * template handed across a boundary into an `<svg>` is the same mistake as `` html`<path/>` ``
     * one namespace over, and it drew nothing and said nothing until the rule became "differs from
     * the host" rather than "is HTML". The message names the namespace it was actually built in.
     */
    const mathInSvg = named(html`<svg><g>${mathml`<u40>x</u40>`}</g></svg>`);
    assert.equal(mathInSvg.length, 1, 'MathML committed into an <svg> is named');
    assert.ok(mathInSvg[0].includes('built as MathML'), 'and named for what it IS, not assumed HTML');

    /**
     * **The annotation ENCODING follows the content, not the host.** `text/html` cannot carry SVG,
     * so naming it for SVG content sends the author to the one spelling that will not work — the
     * same false advice `foreignHost` refuses to print for an `image/svg+xml` host, arriving through
     * an island string shared between the two message branches.
     */
    const svgAdvice2 = named(html`<math><mrow>${svg`<u60>x</u60>`}</mrow></math>`);
    assert.ok(svgAdvice2[0].includes('image/svg+xml'), 'SVG content is annotated image/svg+xml');
    assert.ok(!svgAdvice2[0].includes('text/html'), 'and never text/html, which cannot carry it');
    const htmlAdvice2 = named(html`<math><mrow>${html`<u61>x</u61>`}</mrow></math>`);
    assert.ok(htmlAdvice2[0].includes('text/html'), 'CONTROL: HTML content is annotated text/html');
    assert.ok(!htmlAdvice2[0].includes('image/svg+xml'), 'CONTROL: and never the SVG encoding');
    const svgInMath = named(html`<math><mrow>${svg`<u41>x</u41>`}</mrow></math>`);
    assert.equal(svgInMath.length, 1, 'and SVG committed into a <math> likewise');
    assert.ok(svgInMath[0].includes('built as SVG'), 'named as SVG');

    /**
     * **The ADVICE, not just the label** — asserting only `built as …` is what let this ship wrong.
     * A foreign/foreign mismatch got the HTML message, which told the reader to add the `` svg`…` ``
     * tag to a template that already carried it (the same clause said "was built as SVG"), and
     * offered an island under "if it is genuinely HTML", which excludes the element it just named.
     * Two branches, neither applicable. These two are a DIFFERENT mistake and get their own remedy.
     */
    for (const [what, message, root, island] of [
      ['MathML in SVG', mathInSvg[0], '<math>', '<foreignObject>'],
      ['SVG in MathML', svgInMath[0], '<svg>', '<mtext>'],
    ]) {
      assert.ok(message.includes(root), `${what}: names the root to relocate`);
      assert.ok(message.includes(island), `${what}: and the island that can hold it`);
      assert.ok(!message.includes('needs the svg'), `${what}: never asks for a tag the template already has`);
      assert.ok(!message.includes('genuinely HTML'), `${what}: and never offers HTML advice for non-HTML`);
    }
    assert.ok(
      named(html`<svg><g>${html`<u43>x</u43>`}</g></svg>`)[0].includes('genuinely HTML'),
      'CONTROL: real HTML content still gets both HTML remedies'
    );

    /**
     * The dedupe separates the CONTENT's namespace as well as the host's: `<a>` is a real element in
     * all three, so an HTML `<a>` mistake was spending the pair for a MathML `<a>` one in the very
     * same host, and the second went unreported.
     */
    assert.equal(named(html`<svg><g>${html`<a>x</a>`}</g></svg>`).length, 1, 'an HTML <a> in <g> is named');
    assert.equal(
      named(html`<svg><g>${mathml`<a>x</a>`}</g></svg>`).length,
      1,
      'and a MathML <a> in the same host is a distinct mistake, not a repeat'
    );
    assert.equal(
      named(html`<svg><g>${svg`<u42>x</u42>`}</g></svg>`).length,
      0,
      'CONTROL: content in its host own namespace is correct and stays silent'
    );

    /**
     * `<script>` as well as `<style>` — the message names both and only one was ever rendered, so
     * dropping the `script` arm failed nothing. Neither draws, so "will not render" is the wrong
     * complaint for either.
     */
    assert.equal(
      named(html`<svg><g>${html`<script>var u46 = 1;</script>`}</g></svg>`).length,
      0,
      'an HTML <script> inside an <svg> is silent, exactly as <style> is'
    );

    /**
     * A SPENT key must skip its own node and let a later, fresh one through IN THE SAME CALL. The
     * multi-root case above cannot reach it — both of its tags are fresh, so the dedupe branch never
     * runs — and every list assertion commits each row separately.
     */
    assert.equal(named(html`<svg><g>${html`<u47>a</u47>`}</g></svg>`).length, 1, 'seed: spends <u47>');
    assert.equal(
      named(html`<svg><g>${html`<u47>a</u47><u48>b</u48>`}</g></svg>`).length,
      1,
      'a fresh offender behind a spent one in the same insert is still named'
    );

    /**
     * **A correctly tagged template must stay silent, whitespace included.** The `nodeType` guard
     * became load-bearing the moment the rule changed from "is this XHTML" to "does this differ from
     * the host": a text node has no `namespaceURI`, and `undefined` never equals a foreign host's,
     * so without the guard every newline inside an `svg` template is reported as
     * `<undefined> was built as HTML`. The comment there had been written against the previous rule
     * and said the line could not be told from its absence.
     *
     * The host is `<symbol>` because the key is spent per host NAME: every earlier assertion here
     * uses `<g>`, so the same probe under a `<g>` measures 0 whether the guard is there or not.
     */
    assert.equal(
      named(html`<svg><symbol>${svg`
        <path d="M0 0h24"></path>
      `}</symbol></svg>`).length,
      0,
      'the text nodes around correct SVG content are not elements and are never reported'
    );

    /** Every SVG integration point, not only <foreignObject> — dropping desc/title failed nothing. */
    assert.equal(named(html`<svg><desc>${html`<u3>x</u3>`}</desc></svg>`).length, 0, '<desc> is one too');
    assert.equal(named(html`<svg><title>${html`<v3>x</v3>`}</title></svg>`).length, 0, '<title> likewise');

    /** Every MathML token element, not only <mtext>. */
    assert.equal(named(html`<math><mi>${html`<u4>x</u4>`}</mi></math>`).length, 0, '<mi> is an integration point');
    assert.equal(named(html`<math><mo>${html`<u5>x</u5>`}</mo></math>`).length, 0, '<mo> likewise');
    assert.equal(named(html`<math><mn>${html`<u6>x</u6>`}</mn></math>`).length, 0, '<mn> likewise');
    assert.equal(named(html`<math><ms>${html`<u7>x</u7>`}</ms></math>`).length, 0, '<ms> likewise');

    /**
     * `<annotation-xml>` is an integration point only for the two HTML encodings, and JSX compiles
     * that dash-named tag's attribute to a PROPERTY — so the branch has to read both. This helper
     * covers the ATTRIBUTE spelling; the PROPERTY one is asserted further down, because for a while
     * only this half existed and dropping the property read failed nothing.
     */
    const withEncoding = (value, node) => {
      seen.length = 0;
      const local = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(local);
      renderInto(html`<math><annotation-xml encoding="${value}">${node}</annotation-xml></math>`, local);
      return seen.filter((w) => w.includes('will not render')).length;
    };
    assert.equal(withEncoding('text/html', html`<u8>x</u8>`), 0, 'text/html makes it an integration point');
    assert.equal(
      withEncoding('TEXT/HTML', html`<u44>x</u44>`),
      0,
      'the encoding is compared case-insensitively, as the spec says — dropping .toLowerCase() failed nothing'
    );
    assert.equal(withEncoding('application/mathml+xml', html`<u9>x</u9>`), 1, 'any other encoding does not');
    assert.equal(
      withEncoding('application/xhtml+xml', html`<u35>x</u35>`),
      0,
      'and `application/xhtml+xml` is the OTHER HTML encoding — dropping that arm failed nothing'
    );

    /** And named ONCE: a channel that repeats every frame is as useless as one that stays silent. */
    const repeat = (flag) =>
      html`<svg>${flag ? html`<ellipse rx="1"></ellipse>` : svg`<ellipse rx="1"></ellipse>`}</svg>`;
    const host = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(host);
    seen.length = 0;
    for (let i = 0; i < 20; i++) renderInto(repeat(i % 2 === 0), host);
    assert.equal(
      seen.filter((w) => w.includes('will not render')).length,
      1,
      'twenty renders of a toggling shape name the mistake once, not once per frame'
    );
  } finally {
    console.warn = nativeWarn;
  }
});

/**
 * **A binding inside a raw-text-named element in an inline `<svg>` commits — in BOTH builds.**
 *
 * Deliberately NOT `skip: isProduction`. The scan and the parsed-tree pass both pick raw text by
 * `RAW_TEXT_TAGS` alone — namespace-blind, identical in both builds — and teaching only the SCAN a
 * namespace was tried and reverted: it keyed on the `foreign` depth counter, which is incremented
 * only under `__DEV__` because it exists to gate `warnTagShape`, so the two halves then disagreed
 * BY BUILD. Production rendered the raw marker sentinel into `<title>` and shifted every later
 * child binding by one, silently, in the shipped bundle only — and every assertion in the skipped
 * block above passed throughout, because none of them run in production and none of them read a
 * committed value. That is the hazard this test exists to catch, and it can only catch it by
 * running where the damage was.
 *
 * This is the canonical accessible icon, which is why it is the shape worth pinning.
 */
test('a binding inside <title> in an inline <svg> commits, in development and production alike', () => {
  const icon = (label, d) =>
    html`<svg viewBox="0 0 24 24"><title>${label}</title><path d=${d}></path></svg>`;
  const local = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(local);

  renderInto(icon('Close', 'M0 0h24'), local);
  assert.equal(local.querySelector('title').textContent, 'Close', 'the value committed, not a marker');
  assert.equal(local.querySelector('path').getAttribute('d'), 'M0 0h24', 'and the later binding is not shifted');

  /** Updated through ONE function called twice — two literals would be two templates. */
  renderInto(icon('Open', 'M1 1h22'), local);
  assert.equal(local.querySelector('title').textContent, 'Open', 'and it updates in place');
  assert.equal(local.querySelector('path').getAttribute('d'), 'M1 1h22', 'with its sibling still aligned');

  /** CONTROL: the same shape with a second child binding, which is what shifted. */
  const two = (a, b) => html`<div><svg><title>${a}</title><g>${b}</g></svg></div>`;
  const host2 = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host2);
  renderInto(two('A', 'B'), host2);
  assert.equal(host2.querySelector('title').textContent, 'A', 'first child binding');
  assert.equal(host2.querySelector('g').textContent, 'B', 'CONTROL: the second is not dropped');
});
