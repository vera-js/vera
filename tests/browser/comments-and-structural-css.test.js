/**
 * **Comment nodes are invisible to structural CSS — the platform fact the marker design rests on.**
 *
 * This renderer positions dynamic content with comment markers, `@verajs/renderer/slots` brackets
 * every distributed slot with a pair, and any future positional record would add more. All of that
 * is only safe because a comment is not counted by the structural selectors — so an author's
 * `:nth-child`, `:first-child` and `+` rules keep meaning what they say about the elements they
 * wrote. Nothing in this repository asserted it, which made the single most load-bearing assumption
 * in the layout of rendered DOM also the least examined one.
 *
 * Asked for directly ("it scares me to make that stuff not work"), and the honest answer was a
 * measurement rather than a reassurance.
 *
 * **Browser-only on purpose.** Selector matching is the platform's decision, and this repository has
 * already been burned once by taking jsdom's word on a platform rule (`spread-names.test.js`: jsdom
 * refuses about fifty attribute names every real engine accepts). Chromium, Firefox and WebKit.
 *
 * `:empty` is the case worth having here rather than reasoned about: Selectors 3 said "no children
 * at all", Selectors 4 says "no children, or only white-space text", and neither sentence mentions
 * comments — so whether a comment disqualifies an element was worth asking the engines instead of
 * the specification.
 */
import { expect } from '@esm-bundle/chai';

/** Comments in every position that matters: leading, interleaved, trailing. */
const build = (markup) => {
  const host = document.createElement('div');
  host.innerHTML = markup;
  document.body.appendChild(host);
  return host;
};

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const keep = (node) => {
  made.push(node);
  return node;
};

it('a comment does not occupy a structural position', () => {
  const host = keep(build('<!--m--><b class="a">A</b><!--m--><i class="b">B</i><!--m-->'));
  const a = host.querySelector('.a');
  const b = host.querySelector('.b');

  expect(a.matches(':first-child'), ':first-child looks past a leading comment').to.equal(true);
  expect(b.matches(':last-child'), ':last-child looks past a trailing comment').to.equal(true);
  expect(a.matches(':nth-child(1)'), ':nth-child counts elements, not nodes').to.equal(true);
  expect(b.matches(':nth-child(2)'), 'and the interleaved comment does not shift the count').to.equal(true);
  expect(a.matches(':nth-of-type(1)'), ':nth-of-type likewise').to.equal(true);
  expect(b.matches('.a + .b'), 'the adjacent combinator steps over a comment').to.equal(true);
  expect(b.matches('.a ~ .b'), 'so does the general sibling combinator').to.equal(true);
});

it('an element wrapped in comments is still an only child', () => {
  const host = keep(build('<!--m--><span class="s">S</span><!--m-->'));
  expect(host.querySelector('.s').matches(':only-child')).to.equal(true);
  expect(host.querySelector('.s').matches(':only-of-type')).to.equal(true);
});

it('an element holding nothing but comments is :empty', () => {
  const commented = keep(build('<!--just a comment-->'));
  const bare = keep(build(''));
  expect(bare.matches(':empty'), 'CONTROL: an element with no children at all is :empty').to.equal(true);
  expect(commented.matches(':empty'), 'and a comment does not take that away').to.equal(true);
});

/**
 * The other half of the contract, and the reason this file does not claim comments are invisible
 * FULL STOP: they are nodes, so the node-level APIs see them. `children` and `firstElementChild`
 * are the element-level views that do not — which is what a component reading its own DOM should
 * use, and what this pins so the distinction stays a decision rather than a surprise.
 */
it('but the NODE-level APIs do see them, which is where the line is', () => {
  const host = keep(build('<!--m--><b class="a">A</b><!--m-->'));
  expect(host.children.length, 'element view: one child').to.equal(1);
  expect(host.firstElementChild.className, 'element view: the element').to.equal('a');
  expect(host.childNodes.length, 'node view: comments included').to.equal(3);
  expect(host.firstChild.nodeType, 'node view: the comment comes first').to.equal(8);
  expect(host.textContent, 'comments contribute no text').to.equal('A');
});
