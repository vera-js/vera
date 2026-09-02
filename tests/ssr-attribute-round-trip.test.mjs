/**
 * What the SSR shim writes into markup must read back as what was written.
 *
 * `UNUSABLE_IN_A_NAME` refuses exactly what the engines refuse, which
 * `tests/browser/spread-names.test.js` records in real browsers. Pass 91 established that a guard
 * being right about its refusals says nothing about what it allows, and what this one allows is
 * quotes, `<`, `&`, backticks and every non-ASCII character. Each of those has to survive
 * serialization, or the server and the client hold different trees while neither of them complains.
 *
 * That is the worst failure this package has. Nothing throws; a hydration mismatch surfaces somewhere
 * else entirely, later.
 *
 * ## The oracle
 *
 * A **round trip**: serialize, parse the result with a spec parser, read it back. This needs no
 * opinion about what any engine accepts, so it is not the kind of question `CLAUDE.md` warns against
 * asking jsdom. jsdom appears here only as a parser, and in the second half as the differential
 * `CLAUDE.md` prescribes for auditing this shim.
 *
 * ## Where the round trip is lost on purpose
 *
 * Comment data is emitted **unescaped** by the HTML serialization algorithm, so `<!--a-->b-->` really
 * does end early and leave `b-->` as text. A real DOM does exactly the same, byte for byte. Those
 * cases are pinned as *agreeing with the platform* rather than as passing, because the failure to
 * avoid here is a well-meant "fix" that escapes comment data and makes the server the only DOM that
 * does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const parser = new JSDOM('<!doctype html><body></body>').window.document;
const real = new JSDOM('<!doctype html><body></body>').window.document;
const reparse = (markup) => { const host = parser.createElement('div'); host.innerHTML = markup; return host; };

/** Installs the shim's DOM globals, so it goes after both JSDOMs are captured. */
await import('@verajs/ssr');
const shim = globalThis.document;

const NAMES = ['data-x', 'DataX', 'viewBox', ':x', '@x', '.x', '$x', 'a"b', "a'b", 'a<b', 'a&b', 'a`b', 'a{b', 'a|b', 'a?b', 'a*b', 'a,b', 'a;b', 'a:b', 'a!b', 'a#b', 'a%b', 'a^b', 'a~b', 'a+b', 'a-b', 'a.b', 'a\u00e9b', 'a\u200bb', 'a\ufeffb', 'a\u3042b', 'a\u00a0b', 'a\u{1f600}b', 'a\\b', 'xmlns:x', 'x:y'];
const VALUES = ['v', '', 'a"b', "a'b", 'a<b', 'a>b', 'a&b', 'a&amp;b', 'a\nb', 'a\rb', 'a\tb', 'a b', 'a\u00a0b', 'a`b', 'a\\b', '</div>', '<script>x</script>', 'a\u2028b', 'a\u0085b'];

test('every attribute name the shim accepts survives serialization', () => {
  const problems = [];
  for (const name of NAMES) {
    const element = shim.createElement('div');
    element.setAttribute(name, 'V');
    assert.equal(element.getAttribute(name), 'V', `${name} was accepted but not stored`);
    const markup = element.outerHTML;
    const back = reparse(markup).firstElementChild?.getAttribute(name.toLowerCase());
    if (back !== 'V') problems.push(`${JSON.stringify(name)}: emitted ${JSON.stringify(markup)}, reads back ${JSON.stringify(back)}`);
  }
  assert.deepEqual(problems, [], `the client would read different attributes:\n  ${problems.join('\n  ')}`);
});

test('and every attribute value, including the ones that could close the tag', () => {
  const problems = [];
  for (const value of VALUES) {
    const element = shim.createElement('div');
    element.setAttribute('data-v', value);
    const markup = element.outerHTML;
    const back = reparse(markup).firstElementChild?.getAttribute('data-v');
    if (back !== value) problems.push(`${JSON.stringify(value)}: emitted ${JSON.stringify(markup)}, reads back ${JSON.stringify(back)}`);
  }
  assert.deepEqual(problems, [], `the client would read different values:\n  ${problems.join('\n  ')}`);
});

test('and text content', () => {
  const problems = [];
  for (const text of ['plain', 'a<b', 'a>b', 'a&b', 'a&amp;b', '</div>', '<script>x</script>', 'a\rb']) {
    const element = shim.createElement('div');
    element.textContent = text;
    const markup = element.outerHTML;
    const back = reparse(markup).firstElementChild?.textContent;
    if (back !== text) problems.push(`${JSON.stringify(text)}: emitted ${JSON.stringify(markup)}, reads back ${JSON.stringify(back)}`);
  }
  assert.deepEqual(problems, [], `the client would read different text:\n  ${problems.join('\n  ')}`);
});

/**
 * `-->` and `--!>` both end a comment, and the serialization algorithm does not escape comment data,
 * so the bytes really do say so. The shim must lose this **exactly** as a real DOM loses it.
 */
test('comment data that ends a comment is emitted the way the platform emits it', () => {
  const divergences = [];
  for (const data of ['a-->b', '-->', 'a--!>b', 'a--b', 'plain', 'a>b', '<!--']) {
    const build = (doc) => { const el = doc.createElement('div'); el.appendChild(doc.createComment(data)); return el.outerHTML; };
    const fromShim = build(shim);
    const fromReal = build(real);
    if (fromShim !== fromReal) divergences.push(`${JSON.stringify(data)}: shim ${JSON.stringify(fromShim)}, real ${JSON.stringify(fromReal)}`);
  }
  assert.deepEqual(divergences, [], `the server would emit markup no browser emits:\n  ${divergences.join('\n  ')}`);
});

/** The specific shape, written out, so this still says something if the differential is ever removed. */
test('which means a -- comment really does end early, on both', () => {
  const element = shim.createElement('div');
  element.appendChild(shim.createComment('a-->b'));
  assert.equal(element.outerHTML, '<div><!--a-->b--></div>');
  const children = [...reparse(element.outerHTML).firstElementChild.childNodes];
  assert.deepEqual(children.map((node) => node.nodeType), [8, 3], 'a comment and then text');
  assert.equal(children[0].data, 'a');
  assert.equal(children[1].data, 'b-->');
});
