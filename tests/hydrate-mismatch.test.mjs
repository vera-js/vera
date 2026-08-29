/**
 * **Falling back has to say so.**
 *
 * Hydration adopts the server's DOM, and on any disagreement it clears the container and does a
 * clean client render. The page is correct either way — that is what the fallback is for — and
 * that is exactly the problem: the server's markup has just been thrown away, every byte the
 * server spent producing it was wasted, and the one thing server rendering exists to deliver did
 * not happen. Nothing observable changes. The only symptom is a slower first paint that nobody
 * attributes to anything.
 *
 * The proof it matters is already in `hydrate.ts`: a `<textarea>`, whose value *is* its content and
 * which the template therefore does not describe, abandoned adoption **for the whole page** — and
 * the markup looked right afterwards. That was found by reading the code, because there was nothing
 * to find any other way. React and lit both report a mismatch; this said nothing at all.
 *
 * So the warning is asserted here in two directions: it fires with the *first* place the two
 * renders disagreed, and it stays silent when adoption succeeds — including for the disagreements
 * adoption is designed to absorb, where an attribute is simply re-set.
 *
 * `__DEV__`-only, so the whole file is a development-condition test.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'NodeFilter', 'Comment', 'Text'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { html } = await load('core');
const { renderInto } = await load('renderer/hydrate');

/** Hydrates `template` over `markup` and returns what it warned, plus the DOM it settled on. */
const hydrateOver = (markup, template) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    renderInto(template, host);
  } finally {
    console.warn = warn;
  }
  return { said, text: host.textContent.trim(), host };
};

const skip = isProduction && 'development-only diagnostics';

test('a mismatch names the first place the two renders disagreed', { skip }, () => {
  const cases = [
    ['<p>WRONG</p>', () => html`<p>${'a'}</p>`, /reads "a" here and the markup says "W"/],
    ['<div>a</div>', () => html`<p>${'a'}</p>`, /expected <p> and found <div>/],
    ['<p>a</p><b>x</b>', () => html`<p>${'a'}</p>`, /<b> follows everything the template describes/],
    ['plain', () => html`<p>${'a'}</p>`, /expected <p> and found the text "plain"/],
    ['<ul><li>1</li></ul>', () => html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`, /expected <li> and found nothing/],
    [
      '<ul><li>1</li><li>2</li><li>3</li></ul>',
      () => html`<ul>${[1, 2].map((n) => html`<li>${n}</li>`)}</ul>`,
      /<ul> contains <li>, which the template does not describe/,
    ],
  ];
  for (const [markup, template, expected] of cases) {
    const { said } = hydrateOver(markup, template());
    assert.equal(said.length, 1, `${markup} — expected one warning, got ${JSON.stringify(said)}`);
    assert.match(said[0], /^\[vera\] hydration fell back to a client render: /);
    assert.match(said[0], expected, markup);
    /** And it says what was lost, not just that something was wrong. */
    assert.match(said[0], /server markup was discarded/);
  }
});

/**
 * A comment is the one difference that is not a disagreement — see `passComments` in `hydrate.ts`.
 * The walk is `ELEMENT | TEXT` and the part indices are numbered by that same walker, so a comment
 * is invisible to it in **both** directions: a template's own comment cannot be matched, and a
 * stray one cannot be required. Since a comment renders nothing, neither direction can change what
 * a reader sees — so the symmetric rule (step over them) is the one that keeps hydration, and the
 * alternative cost every commented template its adoption for a difference nobody could observe.
 */
test('a comment is not a disagreement, in either direction', { skip }, () => {
  const cases = [
    /** The server has a comment the template does not describe. */
    ['<!--c--><p>a</p>', () => html`<p>${'a'}</p>`],
    ['<p>a<!--c--></p>', () => html`<p>${'a'}</p>`],
    /** The template has comments the server rendered — the case that was losing hydration. */
    ['<p>a<!--c-->b</p>', () => html`<p>a<!--c-->b</p>`],
    ['<p><!--c--><b>a</b></p>', () => html`<p><!--c--><b>a</b></p>`],
  ];
  for (const [markup, template] of cases) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    const served = host.querySelector('p');
    const said = [];
    const warn = console.warn;
    console.warn = (...args) => said.push(args.join(' '));
    try {
      renderInto(template(), host);
    } finally {
      console.warn = warn;
    }
    assert.deepEqual(said, [], `${markup} — fell back over a comment`);
    /** Adoption, not a re-render: the server's element is still the one in the document. */
    assert.equal(host.querySelector('p'), served, `${markup} — the server's <p> was replaced`);
  }
});

test('the page is still correct after every one of those', { skip }, () => {
  for (const [markup, template] of [
    ['<p>WRONG</p>', () => html`<p>${'a'}</p>`],
    ['<div>a</div>', () => html`<p>${'a'}</p>`],
    ['plain', () => html`<p>${'a'}</p>`],
  ]) {
    const { text, host } = hydrateOver(markup, template());
    assert.equal(text, 'a');
    assert.equal(host.querySelectorAll('p').length, 1, markup);
  }
});

test('adoption that succeeds says nothing', { skip }, () => {
  assert.deepEqual(hydrateOver('<p>a</p>', html`<p>${'a'}</p>`).said, []);
  /** An empty container is a first render, not a discarded one — there was nothing to throw away. */
  assert.deepEqual(hydrateOver('', html`<p>${'a'}</p>`).said, []);
});

test('an attribute disagreement is repaired, not reported — adoption re-sets them', { skip }, () => {
  for (const markup of ['<p class="WRONG">a</p>', '<p>a</p>', '<p class="c" data-extra="1">a</p>']) {
    const { said, host } = hydrateOver(markup, html`<p class=${'c'}>${'a'}</p>`);
    assert.deepEqual(said, [], markup);
    assert.equal(host.querySelector('p').getAttribute('class'), 'c', markup);
  }
});
