/**
 * **Text written into a raw-text element can never close it.**
 *
 * The SSR shim stored what `textContent`/`value` wrote into a `<textarea>`, `<title>`, `<style>`, `<script>`,
 * `<iframe>` or `<noscript>` as MARKUP, which nothing escaped: `textarea.value = '</textarea><img src=x
 * onerror=…>'` served `<textarea></textarea><img src=x onerror=…></textarea>`, a live element built from data. The
 * same text appended as a text node was escaped, so the hole was one setter wide — and parsing RCDATA values
 * correctly (a `&lt;/textarea&gt;` in markup now READS as `</textarea>`) would have widened it to every component
 * that reads a value and writes it back.
 *
 * One rule now, the platform's: a text node is written by its PARENT's rule (`TextShim.markup`) — raw with the end
 * tag neutralized inside `<style>`/`<script>`, escaped everywhere else — and every way content gets in stores text.
 * Each row writes a closer through one path, serializes, parses the output with jsdom, and asserts — as booleans —
 * that the element holds what was written and the output holds no element the input did not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shim = globalThis.document;

const TAGS = ['textarea', 'title', 'style', 'script', 'iframe', 'noscript'];
/** RCDATA decodes references, so escaping round-trips exactly; RAWTEXT keeps its bytes, with the closer neutralized. */
const EXACT = new Set(['textarea', 'title']);

/** The end tag a value carries, in the spellings the tokenizer accepts: any case, then space, `/` or `>`. */
const closers = (tag) => [
  `</${tag}>`,
  `</${tag.toUpperCase()}>`,
  `</${tag[0].toUpperCase()}${tag.slice(1)} >`,
  `</${tag}/>`,
  `</${tag}\t>`,
  `</${tag}\nx>`,
];
const payload = (closer) => `a${closer}<img src=x onerror=alert(1)><b>b</b>`;

/** Every way content reaches the element, each as (host, payload) → the element written. */
const WRITES = {
  textContent: (element, value) => { element.textContent = value; },
  value: (element, value) => {
    if (element.localName === 'textarea') element.value = value;
    else element.textContent = value;
  },
  appendChild: (element, value) => { element.appendChild(shim.createTextNode(value)); },
  'innerHTML (escaped markup)': (element, value) => {
    element.innerHTML = value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
  },
  'parsed, then modified': (element, value) => {
    element.textContent = 'seed';
    const host = shim.createElement('div');
    host.innerHTML = element.outerHTML;
    const parsed = host.firstElementChild;
    parsed.firstChild.data = value;
    element.replaceWith?.(parsed);
    return parsed;
  },
};

const serve = (tag, write, value) => {
  const host = shim.createElement('div');
  const element = shim.createElement(tag);
  host.appendChild(element);
  write(element, value);
  return host.innerHTML;
};

test('a closer written into a raw-text element never escapes it — every tag, path and spelling', () => {
  const failures = [];
  let rows = 0;
  for (const tag of TAGS)
    for (const [path, write] of Object.entries(WRITES))
      for (const closer of closers(tag)) {
        const value = payload(closer);
        /** Escaped markup decodes back to the payload only in RCDATA; raw markup on every tag is the test below. */
        if (path.startsWith('innerHTML') && !EXACT.has(tag)) continue;
        const out = serve(tag, write, value);
        const parsed = real.createElement('div');
        parsed.innerHTML = out;
        rows++;
        const injected = parsed.querySelector('img, b') !== null;
        const one = parsed.children.length === 1 && parsed.firstElementChild.localName === tag;
        const kept = !EXACT.has(tag) || parsed.firstElementChild?.textContent === value;
        if (injected || !one || !kept) failures.push(`<${tag}> ${path} ${JSON.stringify(closer)}: ${JSON.stringify(out)}`);
      }
  /** The control: a run that wrote nothing would pass every row. */
  assert.ok(rows > 150, `only ${rows} rows ran`);
  assert.deepEqual(failures, []);
});

/**
 * `innerHTML` on a raw-text element is parsed in that element's own state with no start tag before it, so no end tag
 * is "appropriate" and the WHOLE string is one text node — `</textarea>` included (decoded first in RCDATA). Compared
 * with jsdom directly, then served and parsed back.
 */
test('raw markup assigned to innerHTML is one text node, as the platform parses it — and served as text', () => {
  const failures = [];
  for (const tag of TAGS) {
    /** jsdom parses `<noscript>` with scripting off; every engine people use parses it as raw text (see escaping.ts). */
    if (tag === 'noscript') continue;
    const value = payload(`</${tag}>`);
    const theirs = real.createElement(tag);
    theirs.innerHTML = value;
    const ours = shim.createElement(tag);
    ours.innerHTML = value;
    if (ours.textContent !== theirs.textContent) failures.push(`<${tag}> holds ${JSON.stringify(ours.textContent)}, the platform ${JSON.stringify(theirs.textContent)}`);
    const host = shim.createElement('div');
    host.appendChild(ours);
    const parsed = real.createElement('div');
    parsed.innerHTML = host.innerHTML;
    if (parsed.querySelector('img, b') !== null) failures.push(`<${tag}> served ${JSON.stringify(host.innerHTML)}`);
  }
  assert.deepEqual(failures, []);
});

/** `textContent` stores exactly what is written: no reference is decoded and no line break normalized. */
test('textContent reads back exactly what was written', () => {
  for (const tag of TAGS) {
    const element = shim.createElement(tag);
    element.textContent = 'a &amp; b\r\nc';
    assert.equal(element.textContent, 'a &amp; b\r\nc', tag);
  }
});

test('the control: the payload does inject when written raw, so the rows above can fail', () => {
  const parsed = real.createElement('div');
  parsed.innerHTML = `<textarea>${payload('</textarea>')}</textarea>`;
  assert.equal(parsed.querySelector('img') !== null, true);
});

test('RCDATA set through innerHTML is decoded text, as the platform parses it', () => {
  for (const tag of EXACT) {
    const theirs = real.createElement(tag);
    theirs.innerHTML = 'a &amp; b\r\n<i>c</i>';
    const ours = shim.createElement(tag);
    ours.innerHTML = 'a &amp; b\r\n<i>c</i>';
    assert.equal(ours.textContent, theirs.textContent, tag);
  }
});

test('a stylesheet keeps its bytes: only the end tag is neutralized', () => {
  const style = shim.createElement('style');
  style.textContent = '.a > .b { content: "&amp;" }';
  assert.equal(style.outerHTML, '<style>.a > .b { content: "&amp;" }</style>');
  style.textContent = 'a{}</style><b>';
  assert.equal(style.outerHTML, '<style>a{}<\\/style><b></style>');
});
