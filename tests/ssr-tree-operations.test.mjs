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

/**
 * **The collection queries, `isEqualNode` and `normalize`** — three more members that answered a
 * constant because there was nothing to look at, and became wrong the moment there was.
 * `getElementsByTagName` returned `[]` for a tree plainly holding matches, `isEqualNode` compared
 * identity (which is what `isSameNode` is for, so two identically-built elements reported
 * themselves different), and `normalize` was a no-op because there were no text nodes to merge.
 */
const populate = (make) => {
  const host = make('div');
  host.innerHTML = '<p class="a x" id="one">1</p><span class="a">2</span><p class="b">3</p>';
  return host;
};

test('the collection queries answer from the tree', () => {
  const check = (label, run) => {
    const mine = run(populate((tag) => document.createElement(tag)));
    const oracle = run(populate((tag) => real.document.createElement(tag)));
    assert.deepEqual(mine, oracle, label);
  };
  check('by tag name', (host) => [...host.getElementsByTagName('p')].map((e) => e.getAttribute('class')));
  check('by tag name, wildcard', (host) => [...host.getElementsByTagName('*')].map((e) => e.localName));
  check('by class name', (host) => [...host.getElementsByClassName('a')].map((e) => e.localName));
  check('by two class names', (host) => [...host.getElementsByClassName('a x')].map((e) => e.localName));
  check('by a class nothing has', (host) => [...host.getElementsByClassName('nope')].length);
  check('by tag name and namespace', (host) =>
    [...host.getElementsByTagNameNS('http://www.w3.org/1999/xhtml', 'p')].map((e) => e.getAttribute('class')));
  check('getElementById', (host) => host.getElementById?.('one')?.localName ?? host.querySelector('#one').localName);
});

test('isEqualNode compares structure, not identity', () => {
  const build = (make) => {
    const one = make('b');
    one.setAttribute('x', '1');
    one.innerHTML = '<i>q</i>';
    return one;
  };
  const check = (label, run) => assert.equal(
    run((tag) => document.createElement(tag)),
    run((tag) => real.document.createElement(tag)),
    label
  );
  check('two identical elements', (make) => build(make).isEqualNode(build(make)));
  check('itself', (make) => { const one = build(make); return one.isEqualNode(one); });
  check('a different tag', (make) => build(make).isEqualNode(make('i')));
  check('a different attribute value', (make) => {
    const other = build(make);
    other.setAttribute('x', '2');
    return build(make).isEqualNode(other);
  });
  check('a different child count', (make) => {
    const other = build(make);
    other.appendChild(make('u'));
    return build(make).isEqualNode(other);
  });
  check('null', (make) => build(make).isEqualNode(null));
});

test('normalize merges adjacent text', () => {
  const check = (label, run) => assert.equal(
    run(document),
    run(real.document),
    label
  );
  check('two text nodes become one', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createTextNode('a'));
    host.appendChild(d.createTextNode('b'));
    host.normalize();
    return `${host.childNodes.length}:${host.firstChild.data}`;
  });
  check('an empty text node is dropped', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createTextNode(''));
    host.appendChild(d.createElement('b'));
    host.normalize();
    return host.childNodes.length;
  });
  check('text either side of an element is left alone', (d) => {
    const host = d.createElement('div');
    host.innerHTML = 'a<b>x</b>c';
    host.normalize();
    return host.childNodes.length;
  });
  check('it reaches into descendants', (d) => {
    const host = d.createElement('div');
    const inner = d.createElement('p');
    inner.appendChild(d.createTextNode('a'));
    inner.appendChild(d.createTextNode('b'));
    host.appendChild(inner);
    host.normalize();
    return inner.childNodes.length;
  });
});

/**
 * `getRootNode({composed: true})` crosses the shadow boundary through the host, which is the whole
 * difference between the two forms. jsdom implements shadow roots, so it decides this one too.
 */
test('getRootNode honours composed', () => {
  const check = (label, run) => assert.equal(run(document), run(real.document), label);
  check('inside a shadow root', (d) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inside = d.createElement('p');
    root.appendChild(inside);
    return inside.getRootNode() === root;
  });
  check('composed crosses the host', (d) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inside = d.createElement('p');
    root.appendChild(inside);
    return inside.getRootNode({ composed: true }) === host;
  });
});

/**
 * **The `ChildNode` trio and the fragment's whole purpose.** `before`, `after` and `replaceWith`
 * were out of scope for needing "the parent it has none of", which stopped being true; a fragment
 * had its markup inlined, so it still reported the children it had supposedly handed over.
 */
test('before, after and replaceWith place content beside a node', () => {
  const check = (label, run) => assert.equal(run(document), run(real.document), label);
  const seed = (d) => {
    const host = d.createElement('div');
    const middle = d.createElement('b');
    host.appendChild(d.createElement('i'));
    host.appendChild(middle);
    host.appendChild(d.createElement('u'));
    return [host, middle];
  };
  check('before', (d) => { const [host, middle] = seed(d); middle.before(d.createElement('s')); return host.innerHTML; });
  check('after', (d) => { const [host, middle] = seed(d); middle.after(d.createElement('s')); return host.innerHTML; });
  check('replaceWith', (d) => { const [host, middle] = seed(d); middle.replaceWith(d.createElement('s')); return host.innerHTML; });
  check('several at once', (d) => {
    const [host, middle] = seed(d);
    middle.after(d.createElement('s'), d.createElement('em'));
    return host.innerHTML;
  });
  check('a string becomes text', (d) => {
    const [host, middle] = seed(d);
    middle.after('plain');
    return host.textContent;
  });
  check('on a node with no parent it does nothing', (d) => {
    const orphan = d.createElement('b');
    orphan.before(d.createElement('i'));
    return orphan.outerHTML;
  });
  check('on a text node', (d) => {
    const host = d.createElement('div');
    const text = d.createTextNode('x');
    host.appendChild(text);
    text.before(d.createElement('b'));
    return host.innerHTML;
  });
});

test('a fragment hands over its children and is left empty', () => {
  const check = (label, run) => assert.equal(run(document), run(real.document), label);
  check('the host gets them', (d) => {
    const fragment = d.createDocumentFragment();
    fragment.appendChild(d.createElement('b'));
    fragment.appendChild(d.createElement('i'));
    const host = d.createElement('div');
    host.appendChild(fragment);
    return `${host.innerHTML}|${host.children.length}`;
  });
  check('and the fragment is emptied', (d) => {
    const fragment = d.createDocumentFragment();
    fragment.appendChild(d.createElement('b'));
    const host = d.createElement('div');
    host.appendChild(fragment);
    return fragment.childNodes.length;
  });
});

/**
 * Assigning `outerHTML` was a `TypeError` — there was no setter — so an ordinary way to swap a node
 * out did nothing on the server and worked in the browser.
 */
test('outerHTML replaces the element in its parent', () => {
  const check = (label, run) => {
    const attempt = (d) => {
      try {
        return ['ok', String(run(d))];
      } catch (error) {
        return ['threw', error.name];
      }
    };
    assert.deepEqual(attempt(document), attempt(real.document), label);
  };
  check('replacing a child', (d) => {
    const host = d.createElement('div');
    const kid = d.createElement('b');
    host.appendChild(kid);
    kid.outerHTML = '<i>y</i>';
    return `${host.innerHTML}|${host.children.length}`;
  });
  /**
   * **A silent no-op, measured rather than guessed.** The obvious guess is
   * `NoModificationAllowedError`, and it is wrong: the spec raises that only when the parent is a
   * *Document*. All three engines and jsdom simply return.
   */
  check('with no parent it returns silently', (d) => {
    const orphan = d.createElement('b');
    orphan.outerHTML = '<i></i>';
    return orphan.outerHTML;
  });
});

/**
 * **What a `<slot>` projects.** `assignedNodes`, `assignedElements` and `assignedSlot` answered
 * nothing for every node, so a component inspecting what it had been handed found an empty list and
 * rendered its fallback content — on the server only, where the browser would have shown the real
 * thing. All of it is answerable here: the host, its children and their `slot` names are all
 * present.
 */
test('a slot projects the host children that name it', () => {
  const build = (d) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot name="title"></slot><slot><i>fallback</i></slot>';
    const titled = d.createElement('h1');
    titled.setAttribute('slot', 'title');
    const body = d.createElement('p');
    host.appendChild(titled);
    host.appendChild(body);
    return [host, root, titled, body];
  };
  const check = (label, run) => assert.equal(run(document), run(real.document), label);

  check('the named slot takes what names it', (d) => {
    const [, root] = build(d);
    return [...root.querySelectorAll('slot')][0].assignedNodes().map((node) => node.nodeName).join(',');
  });
  check('the default slot takes the rest', (d) => {
    const [, root] = build(d);
    return [...root.querySelectorAll('slot')][1].assignedNodes().map((node) => node.nodeName).join(',');
  });
  check('assignedElements filters to elements', (d) => {
    const [, root] = build(d);
    return [...root.querySelectorAll('slot')][0].assignedElements().length;
  });
  check('a node knows its slot', (d) => {
    const [, , titled] = build(d);
    return titled.assignedSlot?.getAttribute('name') ?? 'null';
  });
  check('flatten falls back to the slot content', (d) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<slot><i>fallback</i></slot>';
    return root.querySelector('slot').assignedNodes({ flatten: true }).map((node) => node.nodeName).join(',');
  });
  check('an element that is not a slot assigns nothing', (d) =>
    d.createElement('div').assignedNodes?.().length ?? 'ABSENT');
});
