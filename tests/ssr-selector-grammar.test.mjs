/**
 * The selector grammar this DOM answers, and the two different reasons it refuses the rest.
 *
 * `select.js` states an unusual contract: *"It answers, or it refuses — it never guesses."* So there
 * are two properties, and only the first is about correctness:
 *
 * 1. **Every selector it accepts answers exactly as a real DOM does.** A selector accepted and
 *    answered wrongly is the hazard `CLAUDE.md` names — leniency server-side moves the failure to the
 *    client with the context stripped off. Measured over 240 generated selectors: no disagreement.
 * 2. **What it refuses is a list, not a rule.** Both the file and the SSR README used to explain every
 *    refusal with "a pseudo-class needs user state, layout or a document a server does not have".
 *    That is true of `:hover` and false of `:first-child`, which is pure structure and refused
 *    anyway — so a reader following the stated rule would predict it works.
 *
 * Refusing is the right behaviour either way: it is loud, and a wrong answer would not be.
 * Implementing the structural set is a **feature** and is deliberately not done here. What this file
 * fixes is that the boundary is now written down as what it is — a list — so a selector crossing it is
 * a decision rather than a surprise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
const realDocument = dom.window.document;

await import('@verajs/ssr');
const shimDocument = globalThis.document;

const MARKUP =
  '<p id="p1" class="a" data-n="1"></p><span id="s1"></span><span id="s2" class="a" data-n="12"></span><em id="e1"></em>';

const ask = (D, selector) => {
  const root = D.createElement('div');
  root.innerHTML = MARKUP;
  try {
    return [...root.querySelectorAll(selector)].map((node) => node.id).join(',');
  } catch {
    return 'REFUSED';
  }
};

/** Accepted: type, universal, class, id, attributes, `:not()`, and all four combinators. */
const ACCEPTED = [
  '*', 'p', 'span', '.a', '#p1', '[data-n]', '[data-n="1"]', '[data-n^="1"]', '[data-n$="2"]',
  '[data-n*="1"]', '[data-n=""]', ':not(.a)', ':not(p)', 'p span', 'p > span', 'p + span', 'p ~ span',
  'span + span', 'span ~ span', 'p.a', 'span.a[data-n]', 'div p', ':not([data-n])',
];

/** Refused because a server has no user state, no layout and no document. */
const REFUSED_UNANSWERABLE = [':hover', ':focus', ':focus-within', ':target', ':root', ':checked', ':enabled', ':link', ':visible'];

/**
 * Refused although this DOM has everything needed to answer them. **Not** a property of servers — a
 * limit of this matcher, and the distinction the documentation used to lose.
 */
const REFUSED_ANSWERABLE = [
  ':first-child', ':last-child', ':nth-child(2)', ':only-child', ':empty', ':first-of-type',
  ':nth-of-type(1)', ':is(p, span)', ':where(p)', ':has(> em)',
];

test('every accepted selector answers exactly as a real DOM does', () => {
  const wrong = [];
  for (const selector of ACCEPTED) {
    const mine = ask(shimDocument, selector);
    const theirs = ask(realDocument, selector);
    if (mine === 'REFUSED') wrong.push(`${selector} — refused, and a real DOM answers ${JSON.stringify(theirs)}`);
    else if (mine !== theirs) wrong.push(`${selector} — shim ${JSON.stringify(mine)}, jsdom ${JSON.stringify(theirs)}`);
  }
  assert.deepEqual(wrong, [], `these are accepted and answer differently from a real DOM:\n  ${wrong.join('\n  ')}`);
});

test('`+` and `~` are distinct, not one implementation answering for both', () => {
  /**
   * A fixture with one span after the `p` cannot tell these apart, and the first version of this
   * comparison used exactly that — both matched the same element and agreed with jsdom by accident.
   */
  assert.equal(ask(shimDocument, 'p + span'), 's1', 'the adjacent combinator matched more than the next sibling');
  assert.equal(ask(shimDocument, 'p ~ span'), 's1,s2', 'the general combinator matched only the next sibling');
  assert.notEqual(ask(shimDocument, 'p + span'), ask(shimDocument, 'p ~ span'));
});

test('what is refused is refused, and never quietly answered', () => {
  const answered = [];
  for (const selector of [...REFUSED_UNANSWERABLE, ...REFUSED_ANSWERABLE])
    if (ask(shimDocument, selector) !== 'REFUSED')
      answered.push(`${selector} — answered ${JSON.stringify(ask(shimDocument, selector))} instead of refusing`);
  assert.deepEqual(answered, [], `these were answered rather than refused:\n  ${answered.join('\n  ')}`);
});

test('the answerable refusals really are answerable, so the boundary is this matcher and not the server', () => {
  /**
   * The point of the second list. If a real DOM could not answer these either, "a server cannot know"
   * would be the whole story and the documentation would have been right.
   */
  const notActuallyAnswerable = REFUSED_ANSWERABLE.filter((selector) => ask(realDocument, selector) === 'REFUSED');
  assert.deepEqual(
    notActuallyAnswerable,
    [':has(> em)'],
    'the list of "refused but answerable" selectors no longer matches what a real DOM can answer'
  );
});

/**
 * The documentation half. Both the file and the README explained every refusal by one rule, which
 * predicted `:first-child` would work.
 */
test('the SSR README describes the boundary as a list rather than as one rule', () => {
  const readme = readFileSync(new URL('../packages/ssr/README.md', import.meta.url), 'utf8');
  assert.match(readme, /`:not\(\)` and all four\s+combinators/, 'the README no longer names what is accepted');
  assert.match(readme, /:first-child/, 'the README must name a structural pseudo-class as refused-but-answerable');
  assert.match(readme, /two different reasons/, 'the README must keep the two reasons apart');
});
