/**
 * **`getElementById` compares the id string; it never parses a selector.** The server's answer was a `[id="…"]`
 * selector with only `"` escaped, so a backslash was read as a CSS escape: `a"b` was not found and `a\"]` threw "this
 * DOM cannot answer the selector", which crashes a render on an id that came from a slug, a name or user content.
 * Every row runs the same code on the shim and on jsdom and compares the answers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/** Captured before the shim installs its globals. */
const real = new JSDOM('<!doctype html><body></body>').window.document;
await import('@verajs/ssr');
const shim = globalThis.document;

const IDS = ['plain', 'a"b', 'a\\"]', 'a\\', 'x\\y', 'a]b', "a'b", 'a\nb', ' sp ', '#a.b', ''];

/** [name, (d) => string]: `d` is the document under test. */
const OPS = [
  ...IDS.map((id) => [
    `a fragment finds ${JSON.stringify(id)}`,
    (d) => {
      const fragment = d.createDocumentFragment();
      const host = d.createElement('div');
      const p = d.createElement('p');
      p.setAttribute('id', id);
      host.append(p);
      fragment.append(host);
      return String(fragment.getElementById(id) === p);
    },
  ]),
  ...IDS.map((id) => [
    `the document finds ${JSON.stringify(id)}`,
    (d) => {
      const p = d.createElement('p');
      p.setAttribute('id', id);
      d.body.append(p);
      const answer = String(d.getElementById(id) === p);
      p.remove();
      return answer;
    },
  ]),
  [
    'the first in tree order wins among duplicates',
    (d) => {
      const fragment = d.createDocumentFragment();
      const host = d.createElement('div');
      host.innerHTML = '<section><i id="dup" class="deep"></i></section><b id="dup" class="later"></b>';
      fragment.append(host);
      return fragment.getElementById('dup').className;
    },
  ],
  [
    'an ancestor comes before its descendant',
    (d) => {
      const fragment = d.createDocumentFragment();
      const host = d.createElement('div');
      host.innerHTML = '<section id="dup" class="outer"><i id="dup" class="inner"></i></section>';
      fragment.append(host);
      return fragment.getElementById('dup').className;
    },
  ],
  [
    'an id only inside a template is not found',
    (d) => {
      const fragment = d.createDocumentFragment();
      const host = d.createElement('div');
      host.innerHTML = '<template><p id="t"></p></template>';
      fragment.append(host);
      return String(fragment.getElementById('t'));
    },
  ],
  [
    'a shadow root answers for its own tree, and the document does not see into it',
    (d) => {
      const host = d.createElement('div');
      d.body.append(host);
      const root = host.attachShadow({ mode: 'open' });
      const p = d.createElement('p');
      p.setAttribute('id', 'inside');
      root.append(p);
      const answer = String(root.getElementById('inside') === p) + ':' + String(d.getElementById('inside'));
      host.remove();
      return answer;
    },
  ],
];

const run = (doc, op) => {
  try {
    return op(doc);
  } catch (error) {
    return 'THREW ' + error.name + ': ' + error.message;
  }
};

test('getElementById answers as the engines do, whatever the id holds', () => {
  const differ = [];
  for (const [name, op] of OPS) {
    const ours = run(shim, op);
    const theirs = run(real, op);
    if (ours !== theirs) differ.push(`${name}: shim ${JSON.stringify(ours)}, engines ${JSON.stringify(theirs)}`);
  }
  assert.deepEqual(differ, []);
});

test('CONTROL: the plain id is found on both sides', () => {
  const [, op] = OPS[0];
  assert.equal(run(shim, op), 'true');
  assert.equal(run(real, op), 'true');
});

/**
 * **A query does not change what the server writes.** The walk now parses a descendant's markup, and a parse is kept
 * only when re-serializing it reproduces the string exactly, so an authored spelling the shim would write differently
 * (`<P CLASS=x>`, an unquoted value, a reference) stays the author's string. Each shape is written twice, once after a
 * document query and an ancestor query, once without, and the bytes must be equal.
 */
test('the markup an ancestor query parsed is served byte for byte as authored', () => {
  const SHAPES = [
    '<p id="x" class="a">text</p>',
    '<P CLASS=x ID=up>Upper</P>',
    '<p id=bare data-v=1>bare</p>',
    '<p id="ref">&amp; &lt;b&gt; &#169; &copy;</p>',
    '<svg viewBox="0 0 1 1"><rect id="r"/></svg>',
    '<ul><li id="l">one<li>two</ul>',
    '<table><tr><td id="t">c</table>',
  ];
  const write = (markup, query) => {
    const outer = shim.createElement('section');
    const host = shim.createElement('div');
    host.innerHTML = markup;
    outer.append(host);
    shim.body.append(outer);
    if (query) {
      shim.getElementById('x');
      outer.querySelector('p');
      outer.getElementsByTagName('li');
    }
    const served = outer.outerHTML;
    outer.remove();
    return served;
  };
  const differ = SHAPES.filter((markup) => write(markup, true) !== write(markup, false));
  assert.deepEqual(differ, []);
  /** CONTROL: the query ran on parsed nodes, so the walk did reach the markup it must not have changed. */
  const outer = shim.createElement('section');
  const host = shim.createElement('div');
  host.innerHTML = SHAPES[0];
  outer.append(host);
  assert.equal(outer.querySelector('p')?.getAttribute('class'), 'a');
});
