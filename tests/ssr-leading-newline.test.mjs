/**
 * **Content that begins with a line feed survives the server.**
 *
 * Right after a `<pre>`, `<listing>` or `<textarea>` start tag the HTML parser drops ONE line feed — raw, CR, CRLF or
 * a reference to one. The client sets such content through the DOM, which drops nothing; the server writes markup,
 * which the parser reads. And the platform's own serialization does not guard it: Chromium, Firefox, WebKit and jsdom
 * all serialize a `<pre>` whose text is `"\nabc"` as `<pre>\nabc</pre>`, which parses back as `"abc"` (measured
 * 2026-10-06). So the server wrote what a browser writes and shipped content the client never had.
 *
 * Whatever this package writes for such an element now puts one extra line feed in front of content that starts with
 * one: the serializer (decided on the FINAL first character, since an empty value, a list, a nested template's static
 * or the next static can each be first), the `.textContent`/`.innerHTML`/`.value` route, and the shim's own
 * serialization. And the shim's parser takes the line feed as a browser does. Every row here parses the server's
 * output with jsdom and compares the element's text with what the client holds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await import('@verajs/core');
const { spread } = await import('@verajs/renderer/spread');
const shim = globalThis.document;

/** The element's text after the browser parses `markup` — a textarea's value, since that is what a form submits. */
const parsedText = (markup, selector) => {
  const host = real.createElement('div');
  host.innerHTML = markup;
  const element = host.querySelector(selector);
  return element === null ? null : element.localName === 'textarea' ? element.value : element.textContent;
};

/** [name, template, selector, the text the client holds]. One `draw` per row: two literals are two templates. */
const ROWS = [
  ['a text binding', () => html`<pre>${'\nabc'}</pre>`, 'pre', '\nabc'],
  ['after a bound attribute', () => html`<pre class=${'c'}>${'\nabc'}</pre>`, 'pre', '\nabc'],
  ['an empty first value', () => html`<pre>${''}${'\nabc'}</pre>`, 'pre', '\nabc'],
  ['a null first value', () => html`<pre>${null}${'\nabc'}</pre>`, 'pre', '\nabc'],
  ['an empty list first', () => html`<pre>${[]}${'\nabc'}</pre>`, 'pre', '\nabc'],
  ['a nested template static', () => html`<pre>${html`\nabc`}</pre>`, 'pre', '\nabc'],
  ['a nested static CRLF', () => html`<pre>${html`\r\nabc`}</pre>`, 'pre', '\nabc'],
  ['a nested static reference', () => html`<pre>${html`&#10;abc`}</pre>`, 'pre', '\nabc'],
  ['a list', () => html`<pre>${['\nab', 'c']}</pre>`, 'pre', '\nabc'],
  /** The client's marker sits between the tag and the static, so the static's LF is not first there. */
  ['a static after an empty value', () => html`<pre>${''}\nabc</pre>`, 'pre', '\nabc'],
  ['two lines', () => html`<pre>${'\n\nabc'}</pre>`, 'pre', '\n\nabc'],
  ['a value CR (already escaped)', () => html`<pre>${'\r\nabc'}</pre>`, 'pre', '\r\nabc'],
  ['textarea', () => html`<textarea>${'\nabc'}</textarea>`, 'textarea', '\nabc'],
  ['listing', () => html`<listing>${'\nabc'}</listing>`, 'listing', '\nabc'],
  /** Tag names are ASCII case-insensitive: the plan-time check must not be. */
  ['an upper-case tag', () => html`<PRE>${'\nabc'}</PRE>`, 'pre', '\nabc'],
  ['a mixed-case textarea', () => html`<TextArea>${'\nabc'}</TextArea>`, 'textarea', '\nabc'],
  ['two takers in one template', () => html`<pre>${'\na'}</pre><pre>${'\nb'}</pre>`, 'pre:last-child', '\nb'],
  /** `<pre>` ends foreign content: the parser closes the `<svg>` and the `<pre>` is HTML. */
  ['a <pre> breaking out of <svg>', () => html`<svg><pre>${'\nabc'}</pre></svg>`, 'pre', '\nabc'],
  ['textarea .value', () => html`<textarea .value=${'\nabc'}></textarea>`, 'textarea', '\nabc'],
  ['pre .textContent', () => html`<pre .textContent=${'\nabc'}></pre>`, 'pre', '\nabc'],
  ['pre .innerHTML', () => html`<pre .innerHTML=${'\nabc'}></pre>`, 'pre', '\nabc'],
  ['no leading line feed (control)', () => html`<pre>${'abc'}</pre>`, 'pre', 'abc'],
  /** Negative controls: no extra line feed may be written where none is taken. */
  ['a comment first', () => html`<pre><!--c-->${'\nx'}</pre>`, 'pre', '\nx'],
  ['a <pre> inside an attribute value', () => html`<div title="<pre>">${'\nx'}</div>`, 'div', '\nx'],
  ['a <pre> inside a comment', () => html`<div><!--<pre>-->${'\nx'}</div>`, 'div', '\nx'],
  ['a <pre> inside a textarea', () => html`<textarea><pre>${'\nx'}</textarea>`, 'textarea', '<pre>\nx'],
];

test('every route to a leading line feed reaches the client intact', () => {
  const failures = [];
  for (const [name, draw, selector, want] of ROWS) {
    const out = serializeTemplate(draw());
    const got = parsedText(out, selector);
    if (got !== want) failures.push(`${name}: served ${JSON.stringify(out)}, parsed ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
  }
  assert.deepEqual(failures, []);
});

/** The spread route carries its own host: an earlier `.textContent` binding's host stayed the strip target. */
test('a spread textarea value replaces its content after another content binding', () => {
  const draw = (a, b) => html`<div .textContent=${a}></div><textarea ${spread({ '.value': b })}>old</textarea><p>after</p>`;
  const out = serializeTemplate(draw('x', '\nv'));
  assert.equal(parsedText(out, 'textarea'), '\nv');
  assert.equal(parsedText(out, 'p'), 'after');
});

/** A binding that writes through another branch must not stop the next element's guard (the catch-up in the serializer). */
test('a spread-shaped value after one <pre> leaves the next <pre> guarded', () => {
  const draw = (a, b) => html`<pre>${a}</pre><pre>${b}</pre>`;
  const out = serializeTemplate(draw(spread({}), '\nb'));
  assert.equal(parsedText(out, 'pre:last-child'), '\nb');
});

/**
 * **Exactly at the boundary.** The serializer writes its `\n` only where a static ENDS with the start tag — where a
 * binding's output comes next. An author's own `<pre>\nabc` static is parsed the same way by the client's template,
 * so adding one there would put the line feed back on the server only.
 */
test('the line feed is written exactly where a binding follows the start tag, and nowhere else', () => {
  const bound = (x) => html`<pre>${x}</pre>`;
  const attributeBound = (c, x) => html`<pre class=${c}>${x}</pre>`;
  const authored = (x) => html`<pre>\nabc${x}</pre>`;
  assert.equal(serializeTemplate(bound('x')), '<pre>\nx</pre>');
  assert.equal(serializeTemplate(attributeBound('c', 'x')), '<pre class="c">\nx</pre>');
  assert.equal(serializeTemplate(authored('x')), '<pre>\nabcx</pre>');
  /** An END tag takes nothing: a `\n` after `</pre>` would be real text in the parent. */
  const afterEnd = (x, y) => html`<pre>${x}</pre>${y}`;
  assert.equal(serializeTemplate(afterEnd('x', 'y')), '<pre>\nx</pre>y');
  assert.equal(parsedText(serializeTemplate(authored('x')), 'pre'), 'abcx', 'the client template drops the author\'s line feed too');
  const negatives = ROWS.filter(([name]) => / inside /.test(name) && !/textarea/.test(name)).concat([ROWS.find(([n]) => n === 'a comment first')]);
  assert.equal(negatives.length, 3, 'the negative controls ran');
  for (const [name, draw] of negatives)
    assert.equal(serializeTemplate(draw()).includes('\n\n'), false, `${name}: nothing added`);
});

test('the control: the parser does take a leading line feed, so the rows above can fail', () => {
  assert.equal(parsedText('<pre>\nabc</pre>', 'pre'), 'abc');
  assert.equal(parsedText('<pre>&#10;abc</pre>', 'pre'), 'abc');
});

test('a <script> holding a <pre> is raw text: nothing is added', () => {
  const draw = () => html`<script><pre>${'\nx'}</script>`;
  assert.equal(serializeTemplate(draw()), '<script><pre>\nx</script>');
});

test('the added line feed lands before a <select> value is resolved', () => {
  const draw = () => html`<pre>${'\nx'}</pre><select .value=${'b'}><option value="a">a</option><option value="b">b</option></select>`;
  const out = serializeTemplate(draw());
  assert.equal(parsedText(out, 'pre'), '\nx');
  assert.equal(parsedText(out, 'option[selected]')?.length, 1);
});

test('the shim: a created element serializes so that it parses back to its content', () => {
  for (const tag of ['pre', 'listing', 'textarea']) {
    const element = shim.createElement(tag);
    element.textContent = '\nabc';
    assert.equal(parsedText(element.outerHTML, tag), '\nabc', tag);
    element.textContent = 'abc';
    assert.equal(element.outerHTML, `<${tag}>abc</${tag}>`, `${tag}: nothing added without a line feed`);
  }
});

test('the shim: the parser takes the line feed, and the markup still round-trips byte for byte', () => {
  for (const markup of ['<pre>\nabc</pre>', '<pre>\n\nabc</pre>', '<pre>\r\nabc</pre>', '<pre>&#10;abc</pre>', '<textarea>\nabc</textarea>', '<listing class="x">\nabc</listing>']) {
    const host = shim.createElement('div');
    host.innerHTML = markup;
    const element = host.querySelector('pre, textarea, listing');
    assert.equal(element === null, false, `${JSON.stringify(markup)} has a node view`);
    assert.equal(element.textContent, parsedText(markup, element.localName), JSON.stringify(markup));
    assert.equal(host.innerHTML, markup, `${JSON.stringify(markup)} round-trips`);
  }
});

test('the shim: a parsed element whose content is rewritten writes exactly one guard', () => {
  const host = shim.createElement('div');
  host.innerHTML = '<pre>\nabc</pre>';
  const pre = host.querySelector('pre');
  pre.textContent = '\nxyz';
  assert.equal(parsedText(host.innerHTML, 'pre'), '\nxyz');
  pre.setAttribute('class', 'k');
  assert.equal(parsedText(host.innerHTML, 'pre'), '\nxyz');
});
