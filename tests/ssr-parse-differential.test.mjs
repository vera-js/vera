/**
 * **The SSR parser against parse5, over a corpus.**
 *
 * Markup assigned as a string now gets a node view, which means a parser — and a parser that builds
 * the *wrong* tree is worse than the empty answer it replaced, because it answers a query
 * confidently. So the rule is: **decline, or agree. Never disagree.**
 *
 * parse5 is the oracle and stays a devDependency; nothing ships it. Where our parser returns `null`
 * the input is recorded as declined and nothing is asserted about it beyond the fact that no tree
 * was served. Where it returns a tree, that tree must match parse5's element structure exactly.
 *
 * The second assertion is the one that protects the page: a parse is only *kept* by `nodes.js` if
 * re-serialising it reproduces the input byte for byte, so every accepted input here is also checked
 * for that here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFragment as parse5Fragment } from 'parse5';
import { parseFragment } from '../packages/ssr/src/vera/parse.js';
import { TextShim, CommentShim } from '../packages/ssr/src/vera/nodes.js';
import '@verajs/ssr';

/** Element structure only — the part a selector can see, and where error recovery shows up. */
const ours = (entries) =>
  entries
    .filter((entry) => typeof entry !== 'string' && entry.openTag)
    .map((element) => ({
      tag: element.localName,
      attrs: [...element._attributes].sort(([a], [b]) => (a < b ? -1 : 1)),
      children: ours(element._entries),
    }));

const theirs = (nodes) =>
  nodes
    .filter((node) => node.tagName)
    .map((node) => ({
      tag: node.tagName,
      attrs: node.attrs.map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)),
      children: theirs(node.childNodes ?? []),
    }));

const CORPUS = [
  /* Ordinary, well-formed. */
  '<b>x</b>',
  '<div class="a"><span id="s">t</span></div>',
  '<p>one</p><p>two</p>',
  'plain text',
  'text <b>bold</b> tail',
  '<div\n  class="a"\n  id="b"\n>x</div>',
  '<div class=unquoted>x</div>',
  "<div class='single'>x</div>",
  '<input value="a" disabled>',
  '<div data-x="1" data-y="2"><i></i><u></u></div>',
  '<!-- a comment --><b>after</b>',
  '<b>before</b><!-- c -->',

  /* Void elements. */
  '<br>',
  '<img src="a.png"><hr>',
  '<div><br><br></div>',

  /* Implied end tags — the part of the spec well-formed markup actually leans on. */
  '<ul><li>a<li>b</ul>',
  '<ul><li>a</li><li>b</li></ul>',
  '<ol><li>one<li>two<li>three</ol>',
  '<dl><dt>a<dd>b<dt>c<dd>d</dl>',
  '<select><option>a<option>b</select>',
  '<p>one<p>two',
  '<p>text<div>block</div>',

  /* Raw text. */
  '<style>.a { color: red }</style>',
  '<script>var a = "<b>";</script>',
  '<textarea>a < b</textarea>',
  '<title>t</title>',

  /* Entities. */
  '<p title="a &amp; b">t</p>',
  '<p>a &amp; b</p>',
  '<p title="a &#38; b">t</p>',

  /* Things it is expected to decline rather than guess at. */
  '<div><span>never closed',
  '<b><i></b></i>',
  '<svg><circle /></svg>',
  '<div/>',
  '<table><tr><td>a</td></tr></table>',
  '<table><tbody><tr><td>a</td></tr></tbody></table>',
  '<table><tbody><tr><td>a<td>b</tr></tbody></table>',
  '<template><b>x</b></template>',
  '</stray>',
];

test('never disagrees with parse5 — it matches or it declines', () => {
  const declined = [];
  let agreed = 0;

  for (const markup of CORPUS) {
    const parsed = parseFragment(markup, {
      element: (name) => document.createElement(name),
      text: (data) => new TextShim(data),
      comment: (data) => new CommentShim(data),
    });
    if (parsed === null) {
      declined.push(markup);
      continue;
    }
    const mine = ours(parsed);
    const oracle = theirs(parse5Fragment(markup).childNodes);
    assert.deepEqual(mine, oracle, `disagreed with parse5 about ${JSON.stringify(markup)}`);

    /** And the parse must reproduce its input, or `nodes.js` throws it away. */
    let round = '';
    for (const entry of parsed) round += typeof entry === 'string' ? entry : entry.markup();
    assert.equal(round, markup, `did not round-trip ${JSON.stringify(markup)}`);
    agreed++;
  }

  /**
   * Coverage is reported rather than asserted at a threshold — a number that moves with every
   * corpus entry would put a doc edit in the way of adding a case. What is asserted is that the
   * parser is doing real work rather than declining everything, which is the way a green run here
   * could otherwise mean nothing at all.
   */
  console.log(`      parsed ${agreed}/${CORPUS.length}, declined ${declined.length}`);
  for (const markup of declined) console.log(`      declined: ${JSON.stringify(markup)}`);
  assert.ok(agreed >= CORPUS.length * 0.6, `only ${agreed} of ${CORPUS.length} parsed — too many declines to be useful`);
});
