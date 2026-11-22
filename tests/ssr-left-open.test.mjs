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

const CLOSED = ['<svg><![CDATA[', '<svg><![CDATA[ x', '<table>', '<table><tr><td>', '<table><tr><td><table><tr><td>', '<object>', '<object><param name=a>', '<svg><foreignObject><table><tr><td>'];
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
