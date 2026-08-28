/**
 * The tree operations, against jsdom doing the same thing.
 *
 * `insertBefore`, `replaceChild`, `cloneNode` and `compareDocumentPosition` were all listed out of
 * scope for one reason — *"needs a tree"* — which stopped being true when child nodes started being
 * retained. This is the differential that says they behave like the real ones rather than merely
 * existing.
 *
 * jsdom is a fair oracle **here** in a way it is not for platform-decided behaviour (see CLAUDE.md):
 * this is the spec's tree arithmetic, not an engine's judgement call, and jsdom implements all four.
 * The one exception is noted at `compareDocumentPosition`, where the spec itself leaves part of the
 * answer to the implementation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';

const real = new JSDOM('<!doctype html><body></body>').window;

/** The same three-child fixture on both sides. */
const build = (make) => {
  const host = make('div');
  const kids = ['b', 'i', 'u'].map((tag) => {
    const kid = make(tag);
    host.appendChild(kid);
    return kid;
  });
  return [host, ...kids];
};
const mine = () => build((tag) => document.createElement(tag));
const theirs = () => build((tag) => real.document.createElement(tag));

/** Compare the resulting markup, and the kind of error when one throws. */
const both = (label, run) => {
  const attempt = (fixture, make) => {
    try {
      const value = run(fixture, make);
      return ['ok', value === undefined ? fixture[0].innerHTML : String(value)];
    } catch (error) {
      return ['threw', error.name];
    }
  };
  const a = attempt(mine(), (tag) => document.createElement(tag));
  const b = attempt(theirs(), (tag) => real.document.createElement(tag));
  assert.deepEqual(a, b, `${label}: this DOM ${a.join(' ')}, jsdom ${b.join(' ')}`);
};

test('insertBefore behaves like a real one', () => {
  both('before the middle child', ([host], make) => void host.insertBefore(make('s'), host.children[1]));
  both('before the first child', ([host], make) => void host.insertBefore(make('s'), host.children[0]));
  both('a null reference appends', ([host], make) => void host.insertBefore(make('s'), null));
  both('a reference that is not a child', ([host], make) => void host.insertBefore(make('s'), make('p')));
  both('moving an existing child forwards', ([host]) =>
    void host.insertBefore(host.children[0], host.children[2]));
  both('moving an existing child backwards', ([host]) =>
    void host.insertBefore(host.children[2], host.children[0]));
  both('inserting a node that is not a node', ([host]) => void host.insertBefore(null, host.children[0]));
  both('inserting an ancestor into its descendant', ([host]) =>
    void host.children[0].insertBefore(host, null));
});

test('replaceChild behaves like a real one', () => {
  both('replacing the middle child', ([host], make) => void host.replaceChild(make('s'), host.children[1]));
  both('replacing with an existing child', ([host]) =>
    void host.replaceChild(host.children[0], host.children[2]));
  both('replacing a node that is not a child', ([host], make) =>
    void host.replaceChild(make('s'), make('p')));
  both('replacing with something that is not a node', ([host]) =>
    void host.replaceChild(null, host.children[0]));
});

test('cloneNode behaves like a real one', () => {
  both('a shallow clone is empty', ([host]) => host.cloneNode(false).innerHTML);
  both('a deep clone carries the children', ([host]) => host.cloneNode(true).innerHTML);
  both('the default is shallow', ([host]) => host.cloneNode().innerHTML);
  both('attributes come along', ([host]) => {
    host.setAttribute('data-x', '1');
    return host.cloneNode(true).outerHTML;
  });

  /** The reason it was out of scope: a copy must not share the original's children. */
  const [host] = mine();
  const copy = host.cloneNode(true);
  copy.children[0].setAttribute('added', '1');
  assert.equal(host.innerHTML, '<b></b><i></i><u></u>', 'mutating the clone changed the original');
  assert.match(copy.innerHTML, /added="1"/);
});

/**
 * **Only the connected cases are compared.** For two nodes with no common root the spec returns
 * `DISCONNECTED | IMPLEMENTATION_SPECIFIC` plus a direction it explicitly leaves to the
 * implementation, so requiring jsdom's choice would be asserting an arbitrary bit.
 */
test('compareDocumentPosition behaves like a real one', () => {
  both('itself', ([host]) => host.compareDocumentPosition(host));
  both('a child', ([host]) => host.compareDocumentPosition(host.children[0]));
  both('its parent', ([host]) => host.children[0].compareDocumentPosition(host));
  both('a later sibling', ([host]) => host.children[0].compareDocumentPosition(host.children[2]));
  both('an earlier sibling', ([host]) => host.children[2].compareDocumentPosition(host.children[0]));

  const [host] = mine();
  const stranger = document.createElement('p');
  const answer = host.compareDocumentPosition(stranger);
  assert.equal(answer & 1, 1, 'a disconnected node reports DISCONNECTED');
  assert.equal(answer & 32, 32, 'and IMPLEMENTATION_SPECIFIC');
  assert.ok((answer & 2) || (answer & 4), 'with a direction, whichever it picks');
});

/**
 * `moveBefore` has no jsdom to compare against, so the rule is measured on the engines that ship it
 * — Chromium and Firefox, which agree on all of it; WebKit does not implement it yet.
 *
 * The two error cases are the interesting part, and the second corrected an assumption: a node with
 * **no parent** is a `HierarchyRequestError`, while a *parented* node with a reference that is not a
 * child here is a `NotFoundError`. Different errors from the same call depending on which argument
 * is wrong, checked in that order — reasoning by analogy with `insertBefore` would have got it
 * wrong, and a probe that used an unparented node for both cases hid the difference entirely.
 */
test('moveBefore follows the rule the engines that ship it agree on', () => {
  const host = document.createElement('div');
  const kids = ['b', 'i', 'u'].map((tag) => {
    const kid = document.createElement(tag);
    host.appendChild(kid);
    return kid;
  });

  host.moveBefore(kids[2], kids[0]);
  assert.equal(host.innerHTML, '<u></u><b></b><i></i>', 'it moves within one parent');

  const other = document.createElement('div');
  other.appendChild(document.createElement('s'));
  /** `kids[1]` is the `<i>`; the move above reordered the host to `u, b, i`. */
  other.moveBefore(kids[1], null);
  assert.equal(other.innerHTML, '<s></s><i></i>', 'a null reference appends');
  assert.equal(host.innerHTML, '<u></u><b></b>', 'and it left the first parent');

  assert.throws(() => host.moveBefore(document.createElement('p'), kids[0]),
    (error) => error.name === 'HierarchyRequestError', 'a node with no parent');

  assert.throws(() => host.moveBefore(kids[2], document.createElement('p')),
    (error) => error.name === 'NotFoundError', 'a parented node with a reference that is not a child');
});
