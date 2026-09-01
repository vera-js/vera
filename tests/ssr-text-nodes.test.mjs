/**
 * **Text and comments are nodes**, checked against jsdom doing the same thing.
 *
 * They were object literals with an `innerHTML` string: no identity, no parent, no `nodeType`, and
 * appending one inlined its markup and lost the node. `childNodes` therefore reported `1` for
 * `text <b>bold</b> tail` where every browser says `3`, and `textContent` answered `a &amp; b` for
 * an element holding the text `a & b`, because it stripped tags out of the serialised markup with a
 * regular expression instead of walking anything.
 *
 * jsdom is a fair oracle here for the same reason as the tree operations next door: this is the
 * spec's node model, not an engine judgement call.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';

const real = new JSDOM('<!doctype html><body></body>').window;

/** Run the same thing on both DOMs and compare. */
const both = (label, run) => {
  const attempt = (documentLike) => {
    try {
      return ['ok', String(run(documentLike))];
    } catch (error) {
      return ['threw', error.name];
    }
  };
  assert.deepEqual(attempt(document), attempt(real.document), label);
};

test('childNodes counts text the way a real DOM does', () => {
  const shapes = [
    'text <b>bold</b> tail',
    '<b>a</b><i>b</i>',
    'just text',
    '<b>a</b>trailing',
    'leading<b>a</b>',
    '<b>a</b>',
    'a<!--c-->b',
  ];
  for (const markup of shapes) {
    both(`childNodes.length for ${JSON.stringify(markup)}`, (d) => {
      const host = d.createElement('div');
      host.innerHTML = markup;
      return host.childNodes.length;
    });
    both(`nodeTypes for ${JSON.stringify(markup)}`, (d) => {
      const host = d.createElement('div');
      host.innerHTML = markup;
      return [...host.childNodes].map((node) => node.nodeType).join(',');
    });
    both(`children.length for ${JSON.stringify(markup)}`, (d) => {
      const host = d.createElement('div');
      host.innerHTML = markup;
      return host.children.length;
    });
    both(`textContent for ${JSON.stringify(markup)}`, (d) => {
      const host = d.createElement('div');
      host.innerHTML = markup;
      return host.textContent;
    });
  }
});

test('a text node behaves like one', () => {
  both('nodeType', (d) => d.createTextNode('hi').nodeType);
  both('nodeName', (d) => d.createTextNode('hi').nodeName);
  both('data', (d) => d.createTextNode('hi').data);
  both('nodeValue', (d) => d.createTextNode('hi').nodeValue);
  both('textContent', (d) => d.createTextNode('hi').textContent);
  both('length', (d) => d.createTextNode('hi').length);
  both('data is not markup', (d) => d.createTextNode('<b>&</b>').data);
  both('setting data', (d) => {
    const node = d.createTextNode('a');
    node.data = 'b';
    return node.data;
  });
  both('appended, it escapes into the markup', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createTextNode('<b>&</b>'));
    return host.textContent;
  });
  both('and the element sees it as a child', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createTextNode('x'));
    return `${host.childNodes.length}:${host.firstChild.nodeType}`;
  });
  both('its parent', (d) => {
    const host = d.createElement('div');
    const text = d.createTextNode('x');
    host.appendChild(text);
    return text.parentNode === host;
  });
});

test('a comment behaves like one', () => {
  both('nodeType', (d) => d.createComment('c').nodeType);
  both('nodeName', (d) => d.createComment('c').nodeName);
  both('data', (d) => d.createComment('c').data);
  both('it is in childNodes', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createComment('c'));
    return host.childNodes.length;
  });
  both('but not in children', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createComment('c'));
    return host.children.length;
  });
  both('and contributes nothing to textContent', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createComment('c'));
    host.appendChild(d.createTextNode('x'));
    return host.textContent;
  });
});

test('siblings step over text as well as elements', () => {
  both('nextSibling from the first text', (d) => {
    const host = d.createElement('div');
    host.innerHTML = 'a<b>x</b>c';
    return host.firstChild.nextSibling.nodeName;
  });
  both('nextElementSibling skips text', (d) => {
    const host = d.createElement('div');
    host.innerHTML = '<i>1</i>text<u>2</u>';
    return host.firstElementChild.nextElementSibling.nodeName;
  });
  both('previousSibling', (d) => {
    const host = d.createElement('div');
    host.innerHTML = 'a<b>x</b>c';
    return host.lastChild.previousSibling.nodeName;
  });
});

test('splitText splits in place', () => {
  both('the two halves', (d) => {
    const host = d.createElement('div');
    host.appendChild(d.createTextNode('abcdef'));
    const tail = host.firstChild.splitText(3);
    return `${host.firstChild.data}|${tail.data}|${host.childNodes.length}`;
  });
});

test('a deep clone copies text', () => {
  both('the markup of the copy', (d) => {
    const host = d.createElement('div');
    host.innerHTML = 'a<b>x</b>c';
    return host.cloneNode(true).textContent;
  });
});

/** Round-tripping is what protects the page, so it is asserted for every shape above. */
test('every shape still reproduces its own markup', () => {
  for (const markup of ['text <b>bold</b> tail', 'a &amp; b', 'a<!-- c -->b', '&#60;b&#62;',
                        "<ul class='x'><li>a<li>b</ul>", '<p>a</p>trailing text']) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    void host.childNodes;
    assert.equal(host.innerHTML, markup, `re-serialising changed ${JSON.stringify(markup)}`);
  }
});
