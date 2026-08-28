/**
 * **Child nodes are retained, and serialised when the markup is read.**
 *
 * `appendChild` used to serialise the child into the parent's `innerHTML` string and drop the node.
 * Everything here is a consequence of that: a mutation made after appending was lost, `remove()` was
 * a no-op, `removeChild` did not exist, and an element appended into a second parent stayed in both.
 * None of it produced a diagnostic — the server rendered a page missing content the client would
 * have had.
 *
 * The framework's own render path never calls `appendChild` (templates go straight through the
 * serializer), so this is entirely about **user imperative DOM in `connectedCallback`** — the
 * `createElement` → `appendChild` → populate order, which is completely ordinary.
 *
 * Plan and staging: `internal/docs/PLAN-ssr-node-retention.md`. Step 1 adds no parser, so markup
 * assigned as a *string* is still not nodes; the last test here pins that boundary.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import '@verajs/ssr';

const el = (tag = 'div') => document.createElement(tag);

test('a mutation after appendChild reaches the markup', () => {
  const host = el();
  const kid = el('b');
  host.appendChild(kid);
  kid.textContent = 'set after append';
  kid.setAttribute('data-x', '1');
  assert.equal(host.innerHTML, '<b data-x="1">set after append</b>');
});

test('remove() and removeChild() take the child out', () => {
  const host = el();
  const kid = el('i');
  host.appendChild(kid);
  kid.remove();
  assert.equal(host.innerHTML, '', 'remove() was a silent no-op');
  assert.equal(kid.parentNode, null);

  const second = el('u');
  host.appendChild(second);
  assert.equal(host.removeChild(second), second, 'removeChild returns the node');
  assert.equal(host.innerHTML, '');
});

test('removing a node that is not a child is the platform NotFoundError', () => {
  assert.throws(() => el().removeChild(el('b')), (error) => {
    assert.equal(error.constructor.name, 'DOMException');
    assert.equal(error.name, 'NotFoundError');
    return true;
  });
});

test('appending to a second parent moves the child', () => {
  const first = el();
  const second = el();
  const moved = el('i');
  first.appendChild(moved);
  second.appendChild(moved);
  assert.equal(first.innerHTML, '', 'it left the first parent');
  assert.equal(second.innerHTML, '<i></i>', 'and is in the second');
  assert.equal(moved.parentNode, second);
});

test('the parent chain is real', () => {
  const host = el();
  const kid = el('b');
  host.appendChild(kid);
  assert.equal(kid.parentNode, host);
  assert.equal(kid.parentElement, host);

  /** A shadow root is a parent and is not an element, which `parentElement` has to distinguish. */
  const root = el().attachShadow({ mode: 'open' });
  const inRoot = el('p');
  root.appendChild(inRoot);
  assert.equal(inRoot.parentNode, root);
  assert.equal(inRoot.parentElement, null, 'a shadow root is not an element');
});

test('the node view answers from the retained children', () => {
  const host = el();
  const a = el('b');
  const b = el('i');
  host.appendChild(a);
  host.appendChild(b);
  assert.equal(host.children.length, 2);
  assert.equal(host.childNodes.length, 2);
  assert.equal(host.childElementCount, 2);
  assert.equal(host.hasChildNodes(), true);
  assert.equal(host.firstElementChild, a);
  assert.equal(host.firstChild, a);
  assert.equal(host.lastElementChild, b);
  assert.equal(host.lastChild, b);
});

/**
 * Retaining nodes makes this reachable where inlining markup never could: without the guard the
 * next read of `innerHTML` recurses until the stack ends.
 */
test('a node cannot contain itself', () => {
  const outer = el();
  const inner = el('b');
  outer.appendChild(inner);
  assert.throws(() => inner.appendChild(outer), (error) => {
    assert.equal(error.name, 'HierarchyRequestError');
    return true;
  });
});

/**
 * **The three that used to round-trip through the string.** `prepend` read `innerHTML`, cleared it
 * and wrote it back — which after this change would serialise every retained node into text and
 * store it as one chunk, flattening the tree. Same for `append` with a string and for
 * `insertAdjacentHTML`. Each keeps the nodes now, and this is what says so.
 */
test('prepend, append and insertAdjacentHTML keep node identity', () => {
  const host = el();
  const kept = el('b');
  host.appendChild(kept);

  host.prepend(el('i'));
  assert.equal(host.children.length, 2, 'prepend flattened the tree');
  assert.equal(host.lastElementChild, kept, 'and the original node survived');
  assert.equal(host.innerHTML, '<i></i><b></b>', 'in the right order');

  host.append('text & more');
  assert.equal(host.children.length, 2, 'a string is a chunk, not a node');
  assert.match(host.innerHTML, /text &#38; more$/, 'and it is escaped');

  host.insertAdjacentHTML('beforeend', '<hr>');
  assert.equal(host.lastElementChild, kept, 'insertAdjacentHTML kept the nodes');
  assert.match(host.innerHTML, /<hr>$/);
});

test('assigning innerHTML replaces the children and detaches them', () => {
  const host = el();
  const kid = el('b');
  host.appendChild(kid);
  host.innerHTML = '<p>fresh</p>';
  assert.equal(kid.parentNode, null, 'the old child was detached');
  assert.equal(host.innerHTML, '<p>fresh</p>');
});

/**
 * **The boundary step 1 deliberately leaves.** Markup assigned as a string is not parsed, so it has
 * no node view — and asking for one says so rather than answering emptily in silence. Step 2 of the
 * plan is what closes this.
 */
test('markup assigned as a string has no node view, and warns once', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    const host = el();
    host.innerHTML = '<span>one</span><span>two</span>';
    assert.equal(host.children.length, 0, 'a string is not nodes');
    assert.equal(host.childNodes.length, 0);
    void host.firstElementChild;
    assert.equal(warnings.length, 1, 'warned exactly once, not once per access');
    assert.match(warnings[0], /^\[vera\] ssr:/, 'and carries the framework prefix');
    assert.match(warnings[0], /markup but no child nodes/);
  } finally {
    console.warn = original;
  }
});

/** Nesting has to serialise depth-first in order, which is the whole output contract. */
test('a nested tree serialises in order', () => {
  const host = el();
  const outer = el('section');
  const inner = el('p');
  host.appendChild(outer);
  outer.appendChild(inner);
  inner.textContent = 'deep';
  outer.setAttribute('id', 'o');
  assert.equal(host.innerHTML, '<section id="o"><p>deep</p></section>');
});
