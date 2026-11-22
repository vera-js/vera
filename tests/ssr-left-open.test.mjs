/**
 * **What a template or an `.innerHTML` value leaves open cannot reach the page after it.** The client parses each into
 * a fragment, where the parser closes whatever is left open at the fragment's end; the server concatenates, so the
 * server writes the closers. Three shapes had none: an SVG `<![CDATA[` section, a `<table>` (`</div>` cannot close
 * across one, so the page's next markup became the cell's content) and an `<object>`. A `<plaintext>` has no closer at
 * all — nothing ends one — so it is refused, in every build (`ssr-plaintext`). Every served page is parsed with jsdom:
 * `#after` must be the host's next sibling, holding its own text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const { serializeTemplate } = await import('@verajs/ssr');
const { html } = await import('@verajs/core');

/** A template whose one static is `markup`, built fresh: two literals are two templates, so each shape is its own. */
const literal = (markup) => {
  const strings = Object.assign([markup], { raw: [markup] });
  return html(strings);
};
const child = (markup) => html`<div id="host">${literal(markup)}</div><p id="after">after</p>`;
const value = (markup) => html`<div id="host" .innerHTML=${markup}></div><p id="after">after</p>`;

/** Whether the served page keeps `#after` outside the host, as its own element with its own text. */
const contained = (served) => {
  const doc = new JSDOM(`<!doctype html><body>${served}</body>`).window.document;
  const host = doc.getElementById('host');
  const after = doc.getElementById('after');
  return host !== null && after !== null && !host.contains(after) && after.textContent === 'after';
};

const CLOSED = ['<svg><![CDATA[', '<svg><![CDATA[ x', '<select><![CDATA[><textarea>]]>', '<select><![CDATA[><style>]]>', '<noscript><![CDATA[><textarea>]]>', '<math><![CDATA[ x', '<noscript><textarea>', '<noscript><title>', '<noscript><style>', '<noscript><textarea/>', '<noscript><xmp>', '<select><title>', '<table>', '<table><tr><td>', '<table><tr><td><table><tr><td>', '<object>', '<object><param name=a>', '<svg><foreignObject><table><tr><td>'];
const REFUSED = ['<plaintext>', '<PLAINTEXT>', '<Plaintext>x', '<body><plaintext>', '<table><plaintext>', '<svg><desc><plaintext>', '<math><mtext><plaintext>', '<noscript><plaintext>', '<template><plaintext>', '<plaintext>x</plaintext>'];

test('a CDATA section, a table or an object left open is closed where it was opened', () => {
  const leaked = [];
  for (const markup of CLOSED)
    for (const [route, draw] of [['template', child], ['value', value]])
      if (!contained(serializeTemplate(draw(markup)))) leaked.push(`${route} ${JSON.stringify(markup)}`);
  assert.deepEqual(leaked, []);
});

test('a <plaintext> is refused, in a template and in a value, wherever it would swallow the page', () => {
  const served = [];
  for (const markup of REFUSED)
    for (const [route, draw] of [['template', child], ['value', value]]) {
      try {
        served.push(`${route} ${JSON.stringify(markup)} → ${serializeTemplate(draw(markup))}`);
      } catch (error) {
        if (!/ssr-plaintext/.test(error.message)) served.push(`${route} ${JSON.stringify(markup)} threw ${error.message}`);
      }
    }
  assert.deepEqual(served, []);
});

test('a <plaintext> inside SVG is an SVG element, which ends, and is served', () => {
  const served = serializeTemplate(child('<svg><plaintext>x</plaintext></svg>'));
  assert.ok(contained(served), served);
});

test("a template closes only what it opened: a child's open cell is closed by the parent's own table", () => {
  const parent = (inner) => html`<div id="host"><table><tr>${inner}</tr></table></div><p id="after">after</p>`;
  const served = serializeTemplate(parent(literal('<td>cell')));
  assert.ok(contained(served), served);
  assert.equal((served.match(/<\/table>/g) ?? []).length, 1, served);
  const doc = new JSDOM(`<!doctype html><body>${served}</body>`).window.document;
  assert.equal(doc.querySelector('td')?.textContent, 'cell');
});

test('CONTROL: the oracle sees a swallow — a hand-written open table and plaintext both reach #after', () => {
  assert.equal(contained('<div id="host"><table><tr><td></div><p id="after">after</p>'), false);
  assert.equal(contained('<div id="host"><plaintext></div><p id="after">after</p>'), false);
  assert.equal(contained('<div id="host"></div><p id="after">after</p>'), true);
});

/**
 * **KNOWN, pinned: an end tag the browser ignores inside an open table.** `</div>` cannot close across a `<table>`, so
 * in `<div id=d><table></div>` the browser keeps `div#d` open after the server's `</table>`, so the next `</div>` —
 * here the host's own — closes it instead, and the parent's next markup nests in the host (measured: Chromium, Firefox and WebKit alike). The scan tracks the table, not the elements
 * opened around it, so it cannot know; the template itself is malformed in the browser too. Pinned so a change in
 * either direction is seen.
 */
test('KNOWN: a template that closes its own div across an open table leaves the div open, as the browser does', () => {
  const served = serializeTemplate(child('<div id="d"><table></div>'));
  assert.equal(served, '<div id="host"><div id="d"><table></div></table></div><p id="after">after</p>');
  const doc = new JSDOM(`<!doctype html><body>${served}</body>`).window.document;
  /** The host's own `</div>` then closes `div#d` instead, so `#after` lands one level up: inside the host. */
  assert.equal(doc.getElementById('host').contains(doc.getElementById('after')), true);
});

/**
 * **KNOWN, pinned, the same class: an ordinary element left open inside a `<noscript>`.** With scripting off its
 * content is HTML, and `</noscript>` cannot close across an open `<div>` (a special element ends the search for its
 * start tag), so the server's `</noscript>` is ignored, the host's `</div>` closes the inner div, and the parent's next
 * markup nests in the noscript (jsdom, scripting off). The scan tracks the textarea, not the div, as it tracks the
 * table above; with scripting on the noscript is raw text and closes. Pinned so a change in either direction is seen.
 */
test('KNOWN: a div left open inside a noscript keeps the noscript open with scripting off', () => {
  const served = serializeTemplate(child('<noscript><div><textarea/>'));
  assert.equal(served, '<div id="host"><noscript><div><textarea/></textarea></noscript></div><p id="after">after</p>');
  const doc = new JSDOM(`<!doctype html><body>${served}</body>`).window.document;
  assert.equal(doc.querySelector('noscript').contains(doc.getElementById('after')), true);
});

/**
 * **KNOWN, pinned, the same class: an HTML element left open inside a `<foreignObject>`.** With a `<div>` current, the
 * parser ignores `</foreignObject>` and `</svg>` (a special element ends the search), so the page after the host is
 * caught inside it (measured: it leaks in Chromium, Firefox and WebKit alike). The scan tracks the point, not the div.
 * Pinned so a change in either direction is seen.
 */
test('KNOWN: a div left open inside a foreignObject keeps it open', () => {
  const served = serializeTemplate(child('<svg><foreignObject><div>'));
  assert.equal(served, '<div id="host"><svg><foreignObject><div></foreignobject></svg></div><p id="after">after</p>');
  assert.equal(contained(served), false);
});

/**
 * **A child template starts in its parent's namespace.** Inside `<select>` or `<noscript>` a `<![CDATA[` is a bogus
 * comment to the first `>` (the rows above), inside `<svg>` a section to `]]>`, and a `<plaintext>` ends in SVG and
 * never in HTML. A child inherited only a depth, so it could not tell `<svg>` from `<select>` around it; the parent
 * now hands down the namespace at the hole, and the child reads each as the browser will. Only a bare depth leaves it
 * unknown: there a section is served where both readings end at the same place and refused (`ssr-cdata-unknown`) where
 * they disagree, and a `<plaintext>` is refused.
 */
test("a CDATA section or a plaintext in a child template is read in its parent's namespace", () => {
  const inSvg = (inner) => html`<div id="host"><svg>${inner}</svg></div><p id="after">after</p>`;
  const inSelect = (inner) => html`<div id="host"><select>${inner}</select></div><p id="after">after</p>`;
  const leaked = [];
  for (const [name, draw, markup] of [
    ['svg', inSvg, '<![CDATA[ x ]]>'],
    ['svg', inSvg, '<style><![CDATA[ .a > .b {} ]]></style>'],
    ['svg', inSvg, '<![CDATA[ x'],
    ['svg', inSvg, '<style><![CDATA[ a>b'],
    ['svg', inSvg, '<style><![CDATA[ a>b <title>'],
    ['svg', inSvg, '<plaintext>x</plaintext>'],
    ['select', inSelect, '<![CDATA[ x ]]>'],
    ['select', inSelect, '<![CDATA[><textarea>]]>'],
    ['select', inSelect, '<style><![CDATA[><textarea>]]>'],
  ]) {
    try {
      const served = serializeTemplate(draw(literal(markup)));
      if (!contained(served)) leaked.push(`${name} ${JSON.stringify(markup)} leaked: ${served}`);
    } catch (error) {
      leaked.push(`${name} ${JSON.stringify(markup)} threw ${error.message}`);
    }
  }
  assert.deepEqual(leaked, []);
  /** The icon shape, served as written: CSS with a `>` combinator inside an SVG style's CDATA. */
  assert.equal(serializeTemplate(inSvg(literal('<style><![CDATA[ .a > .b {} ]]></style>'))), '<div id="host"><svg><style><![CDATA[ .a > .b {} ]]></style></svg></div><p id="after">after</p>');
  assert.throws(() => serializeTemplate(inSelect(literal('<plaintext>x</plaintext>'))), /ssr-plaintext/);
  const unknown = [];
  for (const [markup, code] of [
    ['<![CDATA[><textarea>]]>', 'ssr-cdata-unknown'],
    ['<![CDATA[ .a > .b {} ]]>', 'ssr-cdata-unknown'],
    ['<![CDATA[ x', 'ssr-cdata-unknown'],
    ['<plaintext>x</plaintext>', 'ssr-plaintext'],
  ]) {
    try {
      unknown.push(`${JSON.stringify(markup)}: served ${serializeTemplate(literal(markup), 1)}`);
    } catch (error) {
      if (!error.message.includes(code)) unknown.push(`${JSON.stringify(markup)}: threw ${error.message}`);
    }
  }
  assert.deepEqual(unknown, []);
  assert.equal(serializeTemplate(literal('<![CDATA[ x ]]>'), 1), '<![CDATA[ x ]]>');
});

/**
 * **Straight inside an integration point, a `<![CDATA[` reads both ways.** An SVG `title`, `desc` or `foreignObject`, a
 * MathML `mtext`, is itself a foreign element, so a CDATA section opens there and runs to `]]>`; once an HTML element
 * opens in it, the same text is a bogus comment to the first `>`. The scan does not track the HTML elements, so the
 * section is served where both readings end at the same place and refused (`ssr-cdata-unknown`) where they do not —
 * in the template, in a value, in a child template, and in a child rendered into the parent's point.
 */
test('a CDATA section straight inside an integration point is served where both readings agree and refused where they do not', () => {
  const inSvg = (inner) => html`<div id="host"><svg>${inner}</svg></div><p id="after">after</p>`;
  const inTitle = (inner) => html`<div id="host"><svg><title>${inner}</title></svg></div><p id="after">after</p>`;
  const served = [];
  for (const [name, render] of [
    ['template', () => serializeTemplate(child('<svg><title><![CDATA[ x>'))],
    ['value', () => serializeTemplate(value('<svg><title><![CDATA[ x>'))],
    ['child in svg', () => serializeTemplate(inSvg(literal('<title><![CDATA[ x>')))],
    ['child at the point', () => serializeTemplate(inTitle(literal('<![CDATA[ x>')))],
    ['foreignObject', () => serializeTemplate(child('<svg><foreignObject><![CDATA[ x>'))],
    ['mtext', () => serializeTemplate(child('<math><mtext><![CDATA[ x>'))],
    ['desc', () => serializeTemplate(child('<svg><desc><![CDATA[><textarea>]]>'))],
  ]) {
    try {
      served.push(`${name}: served ${render()}`);
    } catch (error) {
      if (!/ssr-cdata-unknown/.test(error.message)) served.push(`${name}: threw ${error.message}`);
    }
  }
  assert.deepEqual(served, []);
  for (const shape of ['<svg><title><![CDATA[ x ]]>', '<svg><foreignObject><![CDATA[ x ]]></foreignObject></svg>'])
    for (const draw of [child, value]) assert.ok(contained(serializeTemplate(draw(shape))), `${shape}`);
  assert.ok(contained(serializeTemplate(inTitle(literal('<![CDATA[ x ]]>')))));
  /** An HTML element current again: a table at the point reads a bogus comment, as HTML does. */
  assert.ok(contained(serializeTemplate(child('<svg><foreignObject><table><![CDATA[ x>'))));
});
