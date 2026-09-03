/**
 * `@verajs/renderer/slots` — light-DOM slot distribution against the built artifacts. The
 * semantics oracle is native shadow DOM (same inputs against a real shadow slot where jsdom can
 * host the comparison); the documented divergence (post-render additions join only WITH a `slot`
 * attribute — `slot=""` reaches the default slot) is pinned as documented, not glossed.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

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

test('AUDIT — a HELD (unassigned) node re-slots too, exactly as native reassigns a light child', async () => {
  const h = host('<p slot="a">movable</p>');
  renderInto(html`<section><slot name="b">b-fallback</slot></section>`, h);
  assert.equal(h.textContent.includes('movable'), false, 'unassigned: held, unrendered');
  assert.equal(slotted(h, 'a').length, 1, 'but captured');
  /** Held nodes wait in a DETACHED fragment — outside the host subtree — so this went unseen
   *  until the observer watched holding as well. */
  slotted(h, 'a')[0].setAttribute('slot', 'b');
  await settle();
  assert.equal(h.querySelector('section').textContent, 'movable', 'it moved into its new slot');
  assert.equal(slotted(h, 'b').length, 1);
  assert.equal(slotted(h, 'a').length, 0, 'and left the old bucket');
  h.remove();
});

/**
 * **The shadow half of the same invariant the server pass had to be corrected for.** Rendering
 * into a shadow root must be untouched by this module: the platform's own slot assignment is the
 * behaviour, and taking it over would be strictly worse. The seam declines any root that is not
 * an element (`nodeType !== 1`), so a shadow root keeps its literal `<slot>`.
 */
test('a SHADOW root is left entirely to native slotting', () => {
  const shadowHost = host('<b slot="header">MINE</b>');
  const root = shadowHost.attachShadow({ mode: 'open' });
  renderInto(card(), root);
  const native = root.querySelector('slot[name="header"]');
  assert.ok(native, 'the native <slot> survives — never unwrapped, never anchored');
  assert.deepEqual(
    native.assignedNodes().map((node) => node.textContent),
    ['MINE'],
    'and the platform assigns to it'
  );
  assert.equal(shadowHost.firstElementChild.parentNode, shadowHost, 'the host keeps its own children');
  assert.deepEqual(slotted(shadowHost, 'header').map((node) => node.textContent), ['MINE'],
    'slotted() reads the native assignment — one accessor, both modes');
});

/* ── The slot ELEMENT as the component's API ──────────────────────────────────────────────────
 *
 * A `<slot>` is not just a position: it is the object a component binds to. `@slotchange` is how a
 * component keeps up with what it was given, `&ref` is how it holds the slot, and
 * `assignedNodes()`/`assignedElements()` are how it reads through either. In light mode the seam
 * takes the element out of the document — and every one of those was silently dead, which is the
 * one place "one version of every component" did not hold. The element is now kept, out of the
 * document but alive, as exactly that API object.
 */

/** The same component both ways, reporting what each `slotchange` saw. */
const recorder = (log) => (event) =>
  log.push(event.target.assignedElements().map((node) => node.textContent).join('+') || '(none)');

test('slotchange fires the same sequence, with the same payload, as NATIVE shadow DOM', async () => {
  const readings = {};
  for (const mode of ['shadow', 'light']) {
    const log = (readings[mode] = []);
    const element = host('<b slot="h">ONE</b>');
    const root = mode === 'shadow' ? element.attachShadow({ mode: 'open' }) : element;
    renderInto(html`<header><slot name="h" @slotchange=${recorder(log)}>fb</slot></header>`, root);
    await settle();

    const added = doc.createElement('b');
    added.setAttribute('slot', 'h');
    added.textContent = 'TWO';
    element.append(added);
    await settle();

    element.querySelector('b').remove();
    await settle();

    /** A node with no `slot` changes no assignment, so the platform fires nothing. */
    element.append(doc.createElement('i'));
    await settle();

    element.querySelectorAll('b').forEach((node) => node.remove());
    await settle();
    element.remove();
  }
  assert.deepEqual(readings.shadow, ['ONE', 'ONE+TWO', 'TWO', '(none)'],
    'CONTROL: the platform itself fires on first assignment and on every change, and only then');
  assert.deepEqual(readings.light, readings.shadow, 'and light mode matches it exactly');
});

test('assignedNodes/assignedElements answer from the live assignment, through &ref and e.target', async () => {
  let held = null;
  let fromEvent = null;
  const element = host('<b slot="h">ONE</b>text');
  renderInto(
    html`<header><slot name="h" &ref=${(node) => { held = node; }}
      @slotchange=${(event) => { fromEvent = event.target; }}>fb-a<i>fb-b</i></slot></header>`,
    element
  );
  await settle();

  assert.equal(held?.localName, 'slot', '&ref hands over the slot element itself');
  assert.equal(fromEvent, held, 'and it is the same object the event targets');
  assert.deepEqual(held.assignedNodes().map((n) => n.textContent), ['ONE']);
  assert.deepEqual(held.assignedElements().map((n) => n.textContent), ['ONE']);

  /** With nothing assigned, `flatten` reads the fallback actually on screen — as the platform does. */
  element.querySelector('b').remove();
  await settle();
  assert.deepEqual(held.assignedNodes(), [], 'unassigned reads empty');
  assert.deepEqual(held.assignedNodes({ flatten: true }).map((n) => n.textContent), ['fb-a', 'fb-b'],
    'and flattened reads the fallback');
  assert.deepEqual(held.assignedElements({ flatten: true }).map((n) => n.localName), ['i'],
    'elements only, when asked for elements');
  element.remove();
});

test('a DYNAMIC slot name routes by the name it actually has, and re-routes when it changes', async () => {
  /** ONE draw function called twice — two literals would be two templates and prove nothing. */
  const draw = (which) => html`<section><slot name=${which}>fb</slot></section>`;
  const element = host('<b slot="a">A-CONTENT</b><i slot="b">B-CONTENT</i>');
  renderInto(draw('a'), element);
  await settle();
  assert.equal(element.querySelector('section').textContent, 'A-CONTENT',
    'the name from the binding, not the (absent) static attribute');

  renderInto(draw('b'), element);
  await settle();
  assert.equal(element.querySelector('section').textContent, 'B-CONTENT', 'renaming re-routes it');
  assert.deepEqual(slotted(element, 'a').map((n) => n.textContent), ['A-CONTENT'],
    'and what it left is still captured, waiting for a slot that wants it');
  element.remove();
});

test('a dynamic name is not mistaken for the DEFAULT slot', async () => {
  const element = host('<b slot="h">NAMED</b>plain text');
  renderInto(html`<header><slot name=${'h'}>fb-named</slot></header><main><slot>fb-default</slot></main>`, element);
  await settle();
  assert.equal(element.querySelector('header').textContent, 'NAMED');
  assert.equal(element.querySelector('main').textContent, 'plain text',
    'the default slot keeps its own content — a nameless-looking named slot used to steal it');
  element.remove();
});

/**
 * **What a slot CANNOT carry in a light component says so.** A light host has no second tree, so
 * the slot element is never rendered and `class`/`style`/`id` have nothing to apply to — while in
 * a shadow root they do apply, because a `<slot>` is a real element there. That asymmetry is the
 * one thing this feature cannot make disappear, so it is announced instead of left to be
 * discovered. Development-only: the guard and the message are folded out of production.
 */
test('a binding that cannot work on a light-DOM slot is diagnosed', { skip: isProduction }, async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    const element = host('<b slot="h">X</b>');
    renderInto(html`<header><slot name="h" class="marker" @slotchange=${() => {}}>fb</slot></header>`, element);
    await settle();
    element.remove();
  } finally {
    console.warn = original;
  }
  const said = warnings.find((message) => message.includes('does nothing in a light-DOM component'));
  assert.ok(said, `expected a diagnostic, got ${JSON.stringify(warnings)}`);
  assert.match(said, /^\[vera\] /, 'every diagnostic this framework prints is findable with one filter');
  assert.match(said, /carries `class`, which does nothing/,
    'the inert list is exactly the attribute that will not work — the bindings that DO work here ' +
    'are events and `&ref`, which never appear as attributes, and `name`, which is excluded');
  assert.match(said, /`&ref` all work here/, 'and it says what to reach for instead');
});

/**
 * **Children that arrive after the element upgrades** — the timing an HTML parser creates whenever
 * the component's definition is already registered, and the reason the "must name its slot" rule
 * bites more often than its wording suggests. Named content still lands, because it names a slot;
 * bare default content does not, and the slot shows its fallback.
 *
 * Pinned as the documented behaviour rather than as a defect. A diagnostic was tried and reverted:
 * the component's OWN rendered output arrives through the same callback (the fragment is inserted
 * after the seam drains), so a warning could not tell the two apart without false-positiving on
 * every light component's first render — which is exactly the ambiguity the rule exists to avoid.
 */
test('children appended AFTER the first render need to name their slot', async () => {
  const element = doc.createElement('div');
  doc.body.append(element);
  renderInto(html`<header><slot name="h">FB-H</slot></header><main><slot>FB-D</slot></main>`, element);
  await settle();
  assert.equal(element.querySelector('main').textContent, 'FB-D', 'CONTROL: nothing supplied yet');

  const named = doc.createElement('b');
  named.setAttribute('slot', 'h');
  named.textContent = 'NAMED';
  element.append(named, doc.createTextNode('bare text'));
  await settle();

  assert.equal(element.querySelector('header').textContent, 'NAMED', 'named content lands — it named a slot');
  assert.equal(element.querySelector('main').textContent, 'FB-D',
    'bare text does NOT — after the first render, an unnamed node is indistinguishable from the component\'s own DOM');

  /** And the one-attribute fix works, which is what the docs point at. */
  const explicit = doc.createTextNode('explicit');
  const carrier = doc.createElement('span');
  carrier.setAttribute('slot', '');
  carrier.append(explicit);
  element.append(carrier);
  await settle();
  assert.equal(element.querySelector('main').textContent, 'explicit', '`slot=""` reaches the default slot');
  element.remove();
});
