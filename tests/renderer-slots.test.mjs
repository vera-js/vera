/**
 * `@verajs/renderer/slots` — light-DOM slot distribution against the built artifacts. The
 * semantics oracle is native shadow DOM (same inputs against a real shadow slot where jsdom can
 * host the comparison); the documented divergence (post-render additions join only WITH a `slot`
 * attribute — `slot=""` reaches the default slot) is pinned as documented, not glossed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, html } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);

const doc = dom.window.document;
/** Observer callbacks are microtasks; a macrotask hop settles any pending batch. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const host = (innerHTML = '') => {
  const element = doc.createElement('div');
  element.innerHTML = innerHTML;
  doc.body.append(element);
  return element;
};
const card = () => html`<article><header><slot name="header"><em>no header</em></slot></header><main><slot>empty</slot></main></article>`;

test('named + default distribution, text and whitespace included, comments never captured', () => {
  const h = host('<h2 slot="header">Hi</h2><!-- note -->plain text<b>bold</b>');
  renderInto(card(), h);
  assert.equal(h.querySelector('header').textContent, 'Hi', 'named content distributed');
  assert.equal(h.querySelector('main').textContent, 'plain textbold', 'text + unattributed element to the default slot');
  assert.equal(h.querySelector('header slot'), null, 'no slot element in the light DOM');
  assert.match(h.querySelector('main').innerHTML, /plain text<b>bold<\/b>/, 'order preserved');
  h.remove();
});

test('fallback shows when nothing is assigned, and only then', () => {
  const h = host('<h2 slot="header">Hi</h2>');
  renderInto(card(), h);
  assert.equal(h.querySelector('header').textContent, 'Hi');
  assert.equal(h.querySelector('main').textContent, 'empty', 'default slot fell back');
  h.remove();
});

test('re-renders leave user nodes in place — element identity and input value survive', () => {
  const h = host('<input slot="header" />');
  const draw = (n) => html`<div>${n}<slot name="header"></slot></div>`;
  renderInto(draw(1), h);
  const input = h.querySelector('input');
  input.value = 'typed';
  for (let i = 2; i <= 20; i++) renderInto(draw(i), h);
  assert.equal(h.querySelector('input'), input, 'same node across 19 re-renders');
  assert.equal(input.value, 'typed', 'its state untouched');
  h.remove();
});

test('LIVE: user removal of an assigned node restores fallback; re-adding restores content', async () => {
  const h = host('<h2 slot="header">Hi</h2>');
  renderInto(card(), h);
  const h2 = h.querySelector('h2');
  h2.remove();
  await settle();
  assert.equal(h.querySelector('header').textContent, 'no header', 'fallback returned when the slot emptied');
  const again = doc.createElement('h2');
  again.setAttribute('slot', 'header');
  again.textContent = 'Back';
  h.append(again);
  await settle();
  assert.equal(h.querySelector('header').textContent, 'Back', 'a slot-attributed addition distributes');
  h.remove();
});

test('LIVE: re-slotting via the slot attribute moves a node between slots', async () => {
  const h = host('<span slot="header">movable</span>');
  renderInto(html`<i><slot name="header">HF</slot></i><u><slot name="footer">FF</slot></u>`, h);
  assert.equal(h.querySelector('i').textContent, 'movable');
  assert.equal(h.querySelector('u').textContent, 'FF');
  h.querySelector('span') ?? assert.fail('span should be findable');
  doc.querySelector('span[slot]')?.setAttribute('slot', 'footer');
  await settle();
  assert.equal(h.querySelector('i').textContent, 'HF', 'left slot fell back');
  assert.equal(h.querySelector('u').textContent, 'movable', 'node moved to its new slot');
  h.remove();
});

test('the documented divergence: post-render additions need a slot attribute; slot="" reaches default', async () => {
  const h = host('');
  renderInto(html`<main><slot>fallback</slot></main>`, h);
  assert.equal(h.querySelector('main').textContent, 'fallback');
  const loose = doc.createElement('p');
  loose.textContent = 'loose';
  h.append(loose);
  await settle();
  assert.equal(h.querySelector('main').textContent, 'fallback', 'attribute-less addition stays outside the slot system (documented)');
  assert.equal(loose.parentNode, h, 'and remains ordinary DOM where the user put it');
  const explicit = doc.createElement('p');
  explicit.setAttribute('slot', '');
  explicit.textContent = 'explicit';
  h.append(explicit);
  await settle();
  assert.equal(h.querySelector('main').textContent, 'explicit', 'slot="" reaches the default slot');
  h.remove();
});

test('duplicate slot names in one template: first in tree order wins, the rest show fallback', () => {
  const h = host('<b slot="dup">D</b>');
  renderInto(html`<i><slot name="dup">first-fb</slot></i><u><slot name="dup">second-fb</slot></u>`, h);
  assert.equal(h.querySelector('i').textContent, 'D', 'the first duplicate (tree order) takes the assignment');
  assert.equal(h.querySelector('u').textContent, 'second-fb', 'the later duplicate shows its fallback');
  h.remove();
});

test('the winning slot removed (branch-away) hands the assignment to the surviving duplicate', () => {
  const h = host('<b slot="dup">D</b>');
  // The first slot lives behind a hold so it can be branched away, leaving the second to inherit.
  // (Mount order: the held inner slot commits after the outer static one, so the outer wins first;
  //  removing the winner promotes the survivor — native's next-in-tree-order.)
  const draw = (first) => html`<i>${hold(first ? html`<slot name="dup">A</slot>` : null)}</i><u><slot name="dup">B</slot></u>`;
  renderInto(draw(true), h);
  // whichever mounted first holds D; the other shows its fallback
  const before = h.textContent;
  assert.ok(before.includes('D'), 'assigned to a winner');
  assert.ok(before.includes('A') || before.includes('B'), 'the loser shows fallback');
  renderInto(draw(false), h); // tear down the held slot
  const after = h.textContent;
  assert.ok(after.includes('D'), 'the assignment survives on the remaining slot');
  h.remove();
});

test('branch-away parks user nodes; the branch returning restores them (same identity)', () => {
  const h = host('<em slot="kept">precious</em>');
  const draw = (open) => html`<div>${hold(open ? html`<p><slot name="kept"></slot></p>` : html`<span>closed</span>`)}</div>`;
  renderInto(draw(true), h);
  const em = h.querySelector('em');
  assert.equal(h.querySelector('p').textContent, 'precious');
  renderInto(draw(false), h);
  assert.equal(h.querySelector('em'), null, 'parked out of the document');
  assert.equal(h.textContent, 'closed');
  renderInto(draw(true), h);
  assert.equal(h.querySelector('em'), em, 'the SAME node returned from parking');
  assert.equal(h.querySelector('p').textContent, 'precious');
  h.remove();
});

test('nested hosts: capture takes direct children only', () => {
  const outer = host('<div slot="a"><span slot="b">deep</span></div>');
  renderInto(html`<slot name="a"></slot><slot name="b">b-fallback</slot>`, outer);
  assert.equal(outer.textContent.includes('deep'), true, 'the inner node travels with its parent');
  assert.equal(outer.textContent.includes('b-fallback'), true, 'and is NOT captured for the outer host');
  outer.remove();
});

test('a shadow root keeps native slotting, untouched', () => {
  const el = doc.createElement('div');
  el.innerHTML = '<i slot="s">native</i>';
  doc.body.append(el);
  const root = el.attachShadow({ mode: 'open' });
  renderInto(html`<b><slot name="s">fb</slot></b>`, root);
  assert.ok(root.querySelector('slot[name="s"]'), 'the slot ELEMENT remains for the platform');
  assert.equal(el.querySelector('i').assignedSlot, root.querySelector('slot'), 'native assignment happened');
  el.remove();
});

test('slotted() answers in both modes', async () => {
  const light = host('<u slot="x">1</u><u slot="x">2</u>text');
  renderInto(html`<slot name="x"></slot><slot></slot>`, light);
  assert.equal(slotted(light, 'x').length, 2);
  assert.equal(slotted(light).length, 1, 'default: the text node');
  assert.equal(slotted(light)[0].nodeType, 3);
  const shadowHost = doc.createElement('div');
  shadowHost.innerHTML = '<u slot="x">n</u>';
  doc.body.append(shadowHost);
  renderInto(html`<slot name="x"></slot>`, shadowHost.attachShadow({ mode: 'open' }));
  assert.equal(slotted(shadowHost, 'x').length, 1, 'shadow mode answers through native assignment');
  light.remove(); shadowHost.remove();
});

test('an unassigned node waits invisibly and appears when its slot mounts later', () => {
  const h = host('<s slot="later">patience</s>');
  const draw = (ready) => html`<div>${hold(ready ? html`<slot name="later"></slot>` : null)}</div>`;
  renderInto(draw(false), h);
  assert.equal(h.querySelector('s'), null, 'not rendered anywhere (native: unassigned = not rendered)');
  assert.equal(slotted(h, 'later').length, 1, 'but still captured');
  renderInto(draw(true), h);
  assert.equal(h.querySelector('s')?.textContent, 'patience', 'appeared when its slot arrived');
  h.remove();
});

test('a node the user adopts while unassigned is respected, not stolen back', () => {
  const h = host('<q slot="gone">mine now</q>');
  const draw = (open) => html`${hold(open ? html`<slot name="gone"></slot>` : null)}`;
  renderInto(draw(true), h);
  const q = h.querySelector('q');
  renderInto(draw(false), h); // parked to holding
  const theirs = doc.createElement('aside');
  doc.body.append(theirs);
  theirs.append(q); // user takes it for their own tree
  renderInto(draw(true), h);
  assert.equal(q.parentNode, theirs, 'the user’s adoption stands');
  assert.equal(slotted(h, 'gone').length, 0, 'and the capture record is purged');
  h.remove(); theirs.remove();
});

test('AUDIT — slotted() matches the platform: <slot name=""> IS the default slot', () => {
  const el = doc.createElement('div');
  el.innerHTML = '<i>default content</i>';
  doc.body.append(el);
  const root = el.attachShadow({ mode: 'open' });
  root.innerHTML = '<slot name=""></slot>';
  /** Native counts an empty name as the default slot; `slot:not([name])` missed it. */
  assert.equal(root.querySelector('slot').assignedNodes().length, 1, 'native assigns it');
  assert.equal(slotted(el).length, 1, 'and so does slotted()');
  el.remove();
});

test('AUDIT — slotted() never builds a selector from the name (a quote threw a DOMException)', () => {
  const el = doc.createElement('div');
  doc.body.append(el);
  el.attachShadow({ mode: 'open' }).innerHTML = '<slot name="ok"></slot>';
  assert.deepEqual(slotted(el, 'a"]b'), [], 'a hostile name answers emptily instead of throwing');
  assert.deepEqual(slotted(el, "x'y"), []);
  el.remove();
});

test('AUDIT — unassigned content is captured, invisible, and shown when its slot arrives', () => {
  const h = host('<p slot="later">waiting</p>');
  renderInto(html`<div>only this</div>`, h);
  assert.equal(h.textContent.includes('waiting'), false, 'unassigned content is not rendered');
  assert.equal(slotted(h, 'later').length, 1, 'but it is preserved');
  renderInto(html`<div>now<slot name="later"></slot></div>`, h);
  assert.equal(h.textContent.includes('waiting'), true, 'and appears when its slot mounts');
  h.remove();
});
