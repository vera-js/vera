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
/**
 * **Foreign content is compared at its boundary only.** `<svg>` and `<math>` switch the spec into
 * rules this parser does not implement, so it models the element and keeps the interior as one
 * opaque chunk — deliberately, because refusing the whole fragment meant a card with an icon in it
 * got no node view at all. Comparing the interior would therefore always fail, and comparing the
 * attributes would fail on casing (`viewBox` stays `viewBox` in the markup and is lowercased on the
 * element, which is what `getAttribute` then answers either way).
 *
 * The comparison stops there rather than being skipped: the element itself, and everything around
 * it, still has to match.
 */
const FOREIGN = new Set(['svg', 'math']);

const ours = (entries) =>
  entries
    .filter((entry) => typeof entry !== 'string' && entry.openTag)
    .map((element) =>
      FOREIGN.has(element.localName)
        ? { tag: element.localName, foreign: true }
        : {
            tag: element.localName,
            attrs: [...element._attributes].sort(([a], [b]) => (a < b ? -1 : 1)),
            children: ours(element._entries),
          }
    );

const theirs = (nodes) =>
  nodes
    .filter((node) => node.tagName)
    .map((node) =>
      FOREIGN.has(node.tagName)
        ? { tag: node.tagName, foreign: true }
        : {
            tag: node.tagName,
            attrs: node.attrs.map((a) => [a.name, a.value]).sort(([a], [b]) => (a < b ? -1 : 1)),
            children: theirs(node.childNodes ?? []),
          }
    );

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

  /* Foreign content: the element is modelled, its interior is kept whole. */
  '<svg viewBox="0 0 8 8"><circle cx="4" /></svg>',
  '<div class="card"><svg viewBox="0 0 8 8"><circle cx="4"/></svg><h2>T</h2></div>',
  '<p>before</p><svg><g><path d="M0 0"/></g></svg><p>after</p>',
  '<math><mi>x</mi></math>',

  /* Markup of the shape components actually emit. */
  '<button type="button" class="btn btn-primary" aria-pressed="false">Save</button>',
  '<div class="card"><header><h2>Title</h2></header><p>Body text.</p></div>',
  '<nav><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li></ul></nav>',
  '<form><label for="n">Name</label><input id="n" name="n" required></form>',
  '<select name="s"><option value="1" selected>One</option><option value="2">Two</option></select>',
  '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>C</td></tr></tbody></table>',
  '<picture><source srcset="a.webp" type="image/webp"><img src="a.png" alt="a"></picture>',
  '<details><summary>More</summary><p>Hidden</p></details>',
  '<slot name="header"></slot><slot></slot>',
  '<my-component prop="1"><span slot="title">T</span></my-component>',
  '<div data-a="1" data-b data-c="">flags</div>',
  '<p>Text with <strong>nesting</strong> and <em>more <code>deep</code></em>.</p>',
  '<div\n><span\n  class="x"\n  >y</span\n></div>',
  '<blockquote cite="https://example.com/a?b=1&amp;c=2">q</blockquote>',
  '<pre>  spaced\n  lines  </pre>',
  '<dl><dt>a<dd>b</dl>',
  '<ruby>base<rt>note</rt></ruby>',
  '<video controls muted playsinline><source src="a.mp4"></video>',
  '<div>&lt;not a tag&gt;</div>',
  '<span>5 &gt; 3 &amp;&amp; 2 &lt; 4</span>',
  '<div title="quotes \'inside\'">x</div>',
  "<div title='double \"inside\"'>x</div>",
  '<input value="">',
  '<div></div><div></div><div></div>',
  '<a href="#">#</a>',
  '<h1>a</h1><h2>b</h2><h3>c</h3>',

  /* Things it is expected to decline rather than guess at. */
  '<div><span>never closed',
  '<b><i></b></i>',
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

/**
 * **The warning for unparsed markup has to describe the parser that exists.**
 *
 * It said "markup assigned as a string is not parsed on the server", which was true before this
 * parser and is now false for almost everything — nested elements, attributes, void elements,
 * comments, an unclosed tag, a table fragment and raw text all parse. Only markup the parser cannot
 * re-serialise byte-identically is declined.
 *
 * The distinction changes what the reader does next. "Not parsed" sends them to rewrite working code
 * with `createElement`; the truth is that one piece of markup was refused and making it well-formed
 * is usually the fix.
 *
 * Asserted as *when it fires* rather than by its words, which is the mistake `core-hook-lifecycle`
 * made with the bare-`render()` message: a literal match pins the wording and leaves the meaning
 * free to drift away from it.
 */
test('the unparsed-markup warning fires only for markup this DOM declines', () => {
  const warnsFor = (markup) => {
    const said = [];
    const { warn } = console;
    console.warn = (...args) => said.push(args.join(' '));
    try {
      const host = document.createElement('div');
      host.innerHTML = markup;
      void host.children.length;
      return { warned: said.some((line) => /could not be parsed/.test(line)), children: host.children.length };
    } finally {
      console.warn = warn;
    }
  };

  /** Everything the parser handles must be quiet *and* produce children. */
  for (const markup of [
    '<b>x</b>',
    '<div><p><i>x</i></p></div>',
    '<a href="/x" class="y">z</a>',
    '<br><img src="x">',
    'lead<b>x</b>tail',
    '<!-- c --><b>x</b>',
    '<p>unclosed',
    '<td>cell</td>',
    '<script>var a = 1;</script>',
  ]) {
    const { warned, children } = warnsFor(markup);
    assert.equal(warned, false, `${markup} warned, but it parses`);
    assert.ok(children > 0, `${markup} produced no children`);
  }

  /** And the declined case warns, with advice that matches why it was declined. */
  const declined = warnsFor('<p>x</b>');
  assert.equal(declined.warned, true, 'a mismatched close should be declined and reported');
  assert.equal(declined.children, 0);
});

test('and the warning does not claim markup is never parsed', () => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    const host = document.createElement('div');
    host.innerHTML = '<p>x</b>';
    void host.children.length;
  } finally {
    console.warn = warn;
  }
  const message = said.find((line) => /could not be parsed/.test(line)) ?? '';
  assert.ok(message, 'the warning did not fire');
  assert.doesNotMatch(
    message,
    /is not parsed|never parsed|not parsed on the server/,
    `the warning claims markup is not parsed, and almost all of it is: ${message}`
  );
});
