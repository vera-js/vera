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

const { wire, html, init, render, createStore } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { slots, slotted } = await load('renderer/slots');
const { spread } = await load('renderer/spread');
const { keyed } = await load('renderer/keyed');
wire([renderer, slots]);

const doc = dom.window.document;
/** Observer callbacks are microtasks; a macrotask hop settles any pending batch. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** For STORE-driven re-renders: the scheduler rides requestAnimationFrame, and under
 *  `pretendToBeVisual` a frame is a ~16 ms timer — `settle`'s setTimeout(0) resolves before it.
 *  Every renderInto-driven test commits synchronously and never needs this. */
const nextFrame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

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

/**
 * **The divergence this test used to document is CLOSED.** Post-render additions no longer need a
 * `slot` attribute: the renderer stamps 100% of its own output (a non-enumerable property, chosen
 * by the structural `_end === null` root test), so an unstamped top-level node is knowably the
 * user's and joins the slot system with full native semantics — attribute-less elements and bare
 * text included. `slot=""`/`slot="name"` still work and still route; they are just no longer the
 * only door. This test asserted the old rule as "documented"; it now asserts native.
 */
test('post-render additions join the slot system with native semantics — no attribute required', async () => {
  const h = host('');
  renderInto(html`<main><slot>fallback</slot></main>`, h);
  assert.equal(h.querySelector('main').textContent, 'fallback');
  const loose = doc.createElement('p');
  loose.textContent = 'loose';
  h.append(loose);
  await settle();
  assert.equal(h.querySelector('main').textContent, 'loose', 'an attribute-less addition reaches the default slot, as native');
  const explicit = doc.createElement('p');
  explicit.setAttribute('slot', '');
  explicit.textContent = 'explicit';
  h.append(explicit);
  await settle();
  assert.equal(h.querySelector('main').textContent, 'looseexplicit', 'slot="" still routes, appended after');
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

/**
 * **A three-level park chain: branch away, come back, and the chain reassembles.** `takeOverSlot`
 * chains nested seams so parking the outer slot parks the ones living in its fallback — and under
 * fragment parking that means the inner binding's anchors and even its DISTRIBUTED content sit
 * inside the outer's fragment when the park fires. The risk being pinned: double-handling (a node
 * rescued by two parks) or a stale chain after restore. STORE-driven shape swaps, so every wait is
 * `nextFrame()` THEN `settle()` per this file's own header rule — the first version awaited bare
 * `settle()`, which resolves before the ~16 ms rAF timer, and read '?' under full-suite CPU load
 * (caught by a red gate, run 3 pass 11).  The oracle is a FRESH host given the same
 * children — round-tripped and fresh must agree on view, on membership, and on node IDENTITY, in
 * both starting states (outer assigned, so the chain is displaced; outer unassigned, so the chain
 * is rendered). Measured clean before pinning.
 */
test('three-level slot chains survive a branch-away round trip, displaced or rendered', async () => {
  customElements.define('pk-host', class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this);
      this.state = createStore({ shape: 'slots' });
      render(() => this.state.shape === 'slots'
        ? html`<div class="box"><slot name="o"><em>E</em><slot name="i"><i>F</i><slot name="x">X</slot></slot></slot></div>`
        : html`<div class="gone">nothing</div>`);
    }
  });
  const make = async (assignO) => {
    const el = doc.createElement('pk-host');
    const nodes = {};
    for (const [name, text] of [['o', 'O1'], ['i', 'I1'], ['x', 'X1']]) {
      if (name === 'o' && !assignO) continue;
      const n = doc.createElement('u');
      n.setAttribute('slot', name);
      n.textContent = text;
      nodes[name] = n;
      el.append(n);
    }
    doc.body.append(el);
    await settle();
    return { el, nodes };
  };
  const view = (el) => (el.querySelector('.box')?.textContent ?? '?').replace(/\s+/g, '');
  const membership = (el) => ['o', 'i', 'x'].map((n) => `${n}:${slotted(el, n).map((x) => x.textContent).join('+') || '-'}`).join(' ');

  /** Displaced chain: outer assigned, so i and x live inside o's park fragment when the park fires. */
  const trip = await make(true);
  const fresh = await make(true);
  trip.el.state.shape = 'plain';
  await nextFrame();
  await settle();
  assert.equal(membership(trip.el), membership(fresh.el), 'membership survives while branched away');
  trip.el.state.shape = 'slots';
  await nextFrame();
  await settle();
  assert.equal(view(trip.el), view(fresh.el), 'round-tripped view equals a fresh host');
  assert.equal(membership(trip.el), membership(fresh.el), 'membership too');
  assert.equal(slotted(trip.el, 'o')[0], trip.nodes.o, 'and the node came back by IDENTITY, not by copy');
  trip.nodes.o.remove();
  fresh.nodes.o.remove();
  await settle();
  assert.equal(view(trip.el), view(fresh.el), 'the displaced chain renders correctly after the round trip');

  /** Rendered chain: outer unassigned, all three levels on screen through their fallbacks. */
  const tripB = await make(false);
  const freshB = await make(false);
  tripB.el.state.shape = 'plain';
  await nextFrame();
  await settle();
  tripB.el.state.shape = 'slots';
  await nextFrame();
  await settle();
  assert.equal(view(tripB.el), view(freshB.el));
  assert.equal(slotted(tripB.el, 'x')[0], tripB.nodes.x, 'deepest-level identity survives too');
  for (const h of [trip.el, fresh.el, tripB.el, freshB.el]) h.remove();
});

/**
 * **`spread()` driving a slot's NAME, and keyed rows wearing `slot` attributes — the module
 * seams meeting capture, measured clean before pinning.** A spread rename lands on the ghost
 * element like any attribute write, the name observer sees it (observers are not tree-bound), and
 * the slot re-routes with the capture map agreeing. Keyed rows are the component's own stamped
 * output, so a `slot` attribute on a row must not get it captured (the output-eaten class), must
 * survive reorder, and must not block a real user node from routing past it.
 */
/**
 * **`assignedSlot` stays `null` — the boundary family's fourth member, pinned.** The reverse lookup
 * is a platform accessor tied to real shadow assignment; overriding it would mean defining a
 * platform property on the USER'S nodes, which this module refuses (its stamps are sigil-named
 * non-enumerables precisely to never collide with anyone's surface). The fact is still available,
 * from the forward direction: the slot handle and `slotted()` both answer it.
 */
test('assignedSlot is null in light mode; the forward reads carry the fact', async () => {
  const element = host('<u slot="h">X</u>');
  const node = element.querySelector('u');
  let handle = null;
  renderInto(html`<div><slot name="h" &ref=${(s) => { handle = s; }}></slot></div>`, element);
  await settle();
  assert.equal(node.assignedSlot, null, 'the platform accessor answers for real shadow trees only');
  assert.equal(handle.assignedNodes()[0], node, 'the slot handle answers forward');
  assert.deepEqual(slotted(element, 'h'), [node], 'and slotted() answers from outside');
  element.remove();
});

/**
 * **The IDL property spellings, closing the platform-surface list.** `element.slot = 'b'` and
 * `handle.name = 'z'` are the property halves of the attribute writes everything else tests — and
 * they work here for a reason worth stating: the ghost is a REAL `HTMLSlotElement` (parsed from
 * the template), so IDL reflection writes the attribute, and the observers watch attributes on
 * detached nodes as well as attached ones. Nothing special-cases properties; parity is inherited
 * from reflection, which is exactly how it should be — but "should" is why this is pinned.
 */
test('IDL property writes — element.slot and slotHandle.name — route like their attributes', async () => {
  const element = host('<u slot="a">A</u><u slot="zzz">B</u>');
  const [a] = element.querySelectorAll('u');
  let hb = null;
  renderInto(html`<p class="pa"><slot name="a">FA</slot></p><p class="pb"><slot name="b" &ref=${(s) => { hb = s; }}>FB</slot></p>`, element);
  await settle();

  a.slot = 'b';
  await settle();
  assert.equal(element.querySelector('.pb').textContent, 'A', 'the .slot property re-routes the node');

  hb.name = 'zzz';
  await settle();
  assert.equal(element.querySelector('.pb').textContent, 'B', 'and .name on the detached ghost re-routes the slot');
  assert.equal(hb.getAttribute('name'), 'zzz', 'because IDL reflection wrote the attribute the observer watches');
  element.remove();
});

test('a spread-driven slot name routes and re-routes', async () => {
  customElements.define('sp-host', class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this);
      this.state = createStore({ attrs: { name: 'a' } });
      render(() => html`<div class="box"><slot ${spread(this.state.attrs)}>FB</slot></div>`);
    }
  });
  const el = doc.createElement('sp-host');
  const a = doc.createElement('u'); a.setAttribute('slot', 'a'); a.textContent = 'A';
  const b = doc.createElement('u'); b.setAttribute('slot', 'b'); b.textContent = 'B';
  el.append(a, b);
  doc.body.append(el);
  await nextFrame();
  await settle();
  assert.equal(el.querySelector('.box').textContent, 'A', 'spread name=a routes a');
  el.state.attrs = { name: 'b' };
  await nextFrame();
  await settle();
  assert.equal(el.querySelector('.box').textContent, 'B', 'a spread rename re-routes');
  assert.deepEqual(slotted(el, 'b').map((n) => n.textContent), ['B'], 'and the capture map agrees');
  el.remove();
});

test('keyed rows carrying slot attributes are own output — never captured, reorder intact', async () => {
  customElements.define('ky-host', class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this);
      this.state = createStore({ order: ['1', '2', '3'] });
      render(() => html`<section>${this.state.order.map((id) => keyed(id, html`<p slot="x">row${id}</p>`))}</section><div class="out"><slot name="x">none</slot></div>`);
    }
  });
  const el = doc.createElement('ky-host');
  doc.body.append(el);
  await nextFrame();
  await settle();
  assert.equal(el.querySelector('section').textContent, 'row1row2row3', 'stamped rows stay put');
  assert.equal(el.querySelector('.out').textContent, 'none', 'the slot shows fallback — no user content');
  el.state.order = ['3', '1', '2'];
  await nextFrame();
  await settle();
  assert.equal(el.querySelector('section').textContent, 'row3row1row2', 'reorder holds');
  const user = doc.createElement('u');
  user.setAttribute('slot', 'x');
  user.textContent = 'USER';
  el.append(user);
  await nextFrame();
  await settle();
  assert.equal(el.querySelector('.out').textContent, 'USER', 'a user node routes past the stamped rows');
  el.remove();
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

/**
 * **`{ flatten: true }` returns SLOTTABLES, and the fallback is not automatically all slottables.**
 *
 * The test above passes a fallback of `fb-a<i>fb-b</i>` — text and an element, every node in it
 * assignable — so it could never see the filter missing, and the filter was missing. `flatten`
 * handed back the fallback region verbatim, which surfaces two things through a public API that
 * the platform does not put there:
 *
 * - a comment the author wrote inside their own fallback content, and
 * - when the fallback holds a NESTED slot, this module's own markers bracketing whatever that
 *   inner slot distributed — an implementation detail escaping through the documented surface.
 *
 * They look like separate bugs and are one: the platform's word is *flattened slottables*, and
 * `slotNameOf` already encodes what a slottable is for the assignment path. Shadow is the oracle
 * for both, as everywhere else here.
 */
test('flatten returns slottables only — not a comment in the fallback, not a nested slot\'s markers', async () => {
  const element = host();
  let held = null;
  renderInto(
    html`<header><slot name="h" &ref=${(node) => { held = node; }}><i>A</i><!--mine--><b>B</b></slot></header>`,
    element
  );
  await settle();
  assert.deepEqual(
    held.assignedNodes({ flatten: true }).map((n) => n.nodeType),
    [1, 1],
    "the author's own comment is not a slottable, so flatten does not return it"
  );

  /**
   * The nested case, which is also the recursion check: the outer slot is unassigned, so its
   * fallback shows, and that fallback IS a slot — whose own assignment is what flattening must
   * reach. The platform recurses; here the inner slot's content is physically in the region, so
   * the recursion is structural and only the markers around it had to go.
   */
  const outer = host('<u slot="i">IN</u>');
  let o = null;
  renderInto(
    html`<header><slot name="o" &ref=${(node) => { o = node; }}><slot name="i">DEEP</slot></slot></header>`,
    outer
  );
  await settle();
  assert.deepEqual(
    o.assignedNodes({ flatten: true }).map((n) => n.localName ?? `#${n.nodeType}`),
    ['u'],
    "the inner slot's assignment, alone — the markers bracketing it are not slottables either"
  );
  outer.querySelector('u').remove();
  await settle();
  assert.deepEqual(
    o.assignedNodes({ flatten: true }).map((n) => n.textContent),
    ['DEEP'],
    "and with the inner slot unassigned too, its own fallback — flattening all the way down"
  );

  /**
   * The staleness half, which is why this reads the region rather than the restore list. The
   * restore list is a snapshot of the slot's template children, and a nested slot redistributes
   * underneath it — so reported from the snapshot, this kept naming the removed `<u>` for the life
   * of the page, and the re-add returned the OLD node rather than the new one. The identities are
   * asserted through `textContent` deliberately: both nodes are `<u>`, so a tag-name check passes
   * on the stale answer.
   */
  const again = doc.createElement('u');
  again.setAttribute('slot', 'i');
  again.textContent = 'BACK';
  outer.append(again);
  await settle();
  assert.deepEqual(
    o.assignedNodes({ flatten: true }).map((n) => n.textContent),
    ['BACK'],
    'a re-add reports the node now in the document, not the one the snapshot remembers'
  );
  element.remove();
  outer.remove();
});

/**
 * **A slot nested in a displaced fallback keeps working — content added to it must not be lost.**
 *
 * The outer slot is assigned, so its fallback — which contains the inner slot — is not on screen.
 * The user then adds a child for that inner slot. In a shadow root nothing about this is special:
 * the inner slot never left the tree, so when the outer slot later falls back, the node is there.
 *
 * Here the fallback had been detached NODE BY NODE, which left the inner binding's anchors
 * parentless. `fill` returned early on them, so the node went into its bucket and nowhere else, and
 * when the outer slot fell back, the restore list put the inner slot's ORIGINAL fallback back over
 * the top. The user's node ended up detached, invisible and unreachable, while the inner slot's own
 * `assignedNodes()` still named it — the failure reports itself as working.
 *
 * Parking the displaced region in a FRAGMENT is what fixes it: anchors keep a parent, so the inner
 * binding places normally, and restoring carries back whatever happened while it was away.
 */
test('content added to a slot inside a displaced fallback survives and appears', async () => {
  const element = host('<u slot="b">15</u>');
  let inner = null;
  renderInto(
    html`<p><slot name="b"><em>E</em><slot name="i" &ref=${(node) => { inner = node; }}>D</slot></slot></p>`,
    element
  );
  await settle();
  assert.equal(element.querySelector('p').textContent, '15', 'CONTROL: the outer slot is assigned');

  const late = doc.createElement('u');
  late.setAttribute('slot', 'i');
  late.textContent = 'LATE';
  element.append(late);
  await settle();
  assert.deepEqual(inner.assignedNodes().map((n) => n.textContent), ['LATE'],
    'the inner slot takes it even though it is not currently rendered');

  element.querySelector('u[slot="b"]').remove();
  await settle();
  assert.equal(element.querySelector('p').textContent, 'ELATE',
    'and when the outer slot falls back, the node is THERE — not the stale original fallback');
  assert.equal(late.isConnected, true, 'the user\'s node is in the document, not stranded detached');
  element.remove();
});

/**
 * **Re-slotting a node OUT of a displaced nested slot.**
 *
 * The node rests in the outer binding's park fragment, which is not in the host's subtree — so the
 * `slot` attribute change was invisible to the observer and the node never moved. `_holding` already
 * carries a comment about exactly this failure, measured against native, and a park is simply a
 * second detached place captured nodes rest in: it needs the same watch.
 *
 * The other half is the placement guard, which reads a node whose parent is neither holding nor the
 * region as one the user has adopted, and purges it rather than stealing it back. A park is a home
 * of OURS, so it is registered as one — and registered per host rather than compared against the
 * binding being filled, since at three levels of nesting the node rests in a fragment belonging to
 * neither binding involved.
 */
test('a node re-slotted out of a displaced nested slot moves to its new slot', async () => {
  const element = host();
  const first = doc.createElement('u');
  first.textContent = '13';
  const second = doc.createElement('u');
  second.setAttribute('slot', 'i');
  second.textContent = '78';
  element.append(first, second);

  let outer = null;
  renderInto(
    html`<p><slot &ref=${(node) => { outer = node; }}><em>E</em><slot name="i">D</slot></slot></p>`,
    element
  );
  await settle();
  assert.deepEqual(outer.assignedNodes().map((n) => n.textContent), ['13'],
    'CONTROL: only the unnamed child is on the default slot to begin with');

  second.setAttribute('slot', '');
  await settle();
  assert.deepEqual(outer.assignedNodes().map((n) => n.textContent), ['13', '78'],
    'changing its slot moves it, as native re-assigns a light child wherever it currently rests');
  assert.equal(element.querySelector('p').textContent, '1378', 'and it is on screen');
  element.remove();
});

/**
 * **A re-slotted node takes its place in LIGHT-TREE order, not the order it arrived.**
 *
 * Native `assignedNodes()` answers in flat-tree order, which for a light child is just its position
 * among the host's children — always readable in a shadow root, because nothing moves. Here the
 * children ARE moved, into a slot's region or out to holding, and once two captured nodes live in
 * different places nothing in the DOM says which came first.
 *
 * That is invisible while a node stays in one bucket, because the bucket was built in order. It
 * surfaces the moment a node changes slot and joins a bucket that already holds nodes coming after
 * it in the light tree. Appending was the old answer, and it read as arrival order: an item toggled
 * into a "pinned" slot jumped to the end of the pinned list instead of holding its place.
 *
 * Both halves are here because they failed for different reasons. A node that has been present
 * since capture is ranked by the capture walk. One inserted at the FRONT after render is ranked by
 * the rule the module already states — content in the light region precedes everything distributed
 * away — and ranking it from its bucket's neighbours instead put it last whenever that bucket was
 * empty, where the position means nothing.
 */
test('re-slotting places a node by light-tree order, not arrival order', async () => {
  const element = host();
  const early = doc.createElement('u');
  early.textContent = 'EARLY';
  element.append(early);

  let slot = null;
  renderInto(html`<p><slot name="a" &ref=${(node) => { slot = node; }}>F</slot></p>`, element);
  await settle();

  const late = doc.createElement('u');
  late.setAttribute('slot', 'a');
  late.textContent = 'LATE';
  element.append(late);
  await settle();
  assert.deepEqual(slot.assignedNodes().map((n) => n.textContent), ['LATE'], 'CONTROL: only the named one');

  early.setAttribute('slot', 'a');
  await settle();
  assert.deepEqual(slot.assignedNodes().map((n) => n.textContent), ['EARLY', 'LATE'],
    'the node present since capture keeps its place ahead of the one appended later');

  /** Inserted at the front of the light region AFTER the render, into a bucket holding nothing. */
  const front = doc.createElement('u');
  front.textContent = 'FRONT';
  element.insertBefore(front, element.firstChild);
  await settle();
  front.setAttribute('slot', 'a');
  await settle();
  assert.deepEqual(slot.assignedNodes().map((n) => n.textContent), ['FRONT', 'EARLY', 'LATE'],
    'and a front insertion precedes everything already distributed away');
  element.remove();
});

/**
 * **`host.insertBefore(node, myChild)` throws once `myChild` has been distributed — and the modern
 * spelling does not.**
 *
 * This is the sharpest consequence of light-DOM slots, and the most ordinary thing to hit: a light
 * host's children are physically MOVED into the slot's region, so a node the user appended and kept
 * a reference to is no longer a direct child of the host. `insertBefore` requires its reference node
 * to be a child of the node it is called on, so the platform throws `NotFoundError`. In a shadow
 * root the same code works, because there the child never moves.
 *
 * There is no fixing it from inside the module — the node has to move for light DOM to render it,
 * and nothing can intercept a native `insertBefore`. What there is instead is an answer that works
 * in BOTH modes: `myChild.before(node)` and `myChild.after(node)` route through the node's own
 * current parent, wherever that is. So the guidance is not "light DOM is different here, cope" but
 * "use the spelling that is correct in both", which is also the modern one.
 *
 * Both halves are pinned because the docs now teach exactly this, and a promise about a workaround
 * is worth less than the failure it works around if only the failure is tested.
 */
test('insertBefore against a distributed child throws — before()/after() are the answer', async () => {
  const element = host();
  const mine = doc.createElement('b');
  mine.textContent = 'MINE';
  element.append(mine);

  let slot = null;
  renderInto(html`<div class="box"><slot &ref=${(node) => { slot = node; }}></slot></div>`, element);
  await settle();

  assert.equal(mine.parentNode === element, false,
    'CONTROL: the distributed child is no longer a DIRECT child of the host — the whole cause');
  assert.throws(
    () => element.insertBefore(doc.createElement('u'), mine),
    /NotFoundError|not a child/i,
    'so the platform refuses the insert, where a shadow host would accept it'
  );

  const head = doc.createElement('u');
  head.textContent = 'NEW';
  mine.before(head);
  await settle();
  assert.deepEqual(slot.assignedNodes().map((n) => n.textContent), ['NEW', 'MINE'],
    'before() goes through the node\'s CURRENT parent, so it works — and lands in the right place');

  const tail = doc.createElement('u');
  tail.textContent = 'TAIL';
  mine.after(tail);
  await settle();
  assert.deepEqual(slot.assignedNodes().map((n) => n.textContent), ['NEW', 'MINE', 'TAIL'],
    'and so does after()');
  element.remove();
});

/**
 * **A `<slot name=${…}>` renames while DISPLACED, and the rename is honored — measured against
 * shadow.** The ghost slot element is detached (an API object), and its binding is parked inside
 * the outer slot's fallback fragment; the rename is seen by the observer that watches the ghost
 * itself (`attributeFilter: ['name']` — observers are not tree-bound), the held node for the NEW
 * name assigns immediately (assignment is independent of rendering), and when the outer slot later
 * falls back, the renamed slot renders its assignment rather than its stale fallback. Every clause
 * is a fragment-era path nothing else exercises.
 */
test('renaming a displaced slot re-routes it, and the fallback renders the new assignment', async () => {
  const element = host();
  const own = doc.createElement('u');
  own.setAttribute('slot', 'o');
  own.textContent = 'OWN';
  const held = doc.createElement('b');
  held.setAttribute('slot', 'z');
  held.textContent = 'Z';
  element.append(own, held);

  let inner = null;
  renderInto(
    html`<div class="box"><slot name="o"><em>E</em><slot name="i" &ref=${(node) => { inner = node; }}>D</slot></slot></div>`,
    element
  );
  await settle();

  inner.setAttribute('name', 'z');
  await settle();
  assert.deepEqual(inner.assignedNodes().map((n) => n.textContent), ['Z'],
    'the held node for the NEW name assigned while the slot was displaced');

  own.remove();
  await settle();
  assert.equal(element.querySelector('.box').textContent.replace(/\s+/g, ''), 'EZ',
    'and the restored fallback renders the renamed slot\'s assignment — E then Z, no stale D');
  element.remove();
});

/**
 * **`slotchange` is delivered, never propagated — the boundary, stated and pinned both ways.**
 *
 * In a shadow root the slot elements form a tree, so one listener on the root hears every slot's
 * `slotchange` by bubbling — the canonical pattern — and a slot nested in another slot's fallback
 * bubbles through the outer slot element on its way up. A light host's slot handles are
 * deliberately detached (they are API objects, not positions — see below), so there is no tree for
 * the event to climb: `host.addEventListener('slotchange', …)` hears silence, with no error, which
 * is exactly the shape a migrating shadow user writes first. The event is dispatched with
 * `bubbles: true`, faithfully — it simply has nowhere to go.
 *
 * Simulating the climb was considered and refused: re-dispatching on the host forges
 * `event.target`, which is the property every canonical handler reads (`e.target.assignedNodes()`),
 * and a forged target is worse than a stated boundary. Same family as `querySelector('slot')` and
 * `host.insertBefore`: fewer PLACES to listen, not fewer events.
 *
 * The half that holds is pinned first, because it is the half that matters: DIRECT binding —
 * `@slotchange` or a listener on the handle — hears every event, including on a slot whose
 * rendering is currently DISPLACED (assignment is independent of rendering, and native fires for a
 * hidden slot's assignment change too — measured).
 */
test('slotchange reaches a direct listener even while the slot is displaced — and never the host', async () => {
  const element = host('<u slot="o">OWN</u>');
  let inner = null;
  const onInner = [];
  const onHost = [];
  element.addEventListener('slotchange', () => onHost.push('heard'));
  renderInto(
    html`<div><slot name="o"><em>E</em><slot name="i" &ref=${(node) => { inner = node; }} @slotchange=${(e) => onInner.push(e.target.assignedNodes().map((n) => n.textContent).join(','))}>D</slot></slot></div>`,
    element
  );
  await settle();

  /** The outer slot is assigned, so the inner slot is parked in the outer's fallback fragment. */
  const late = doc.createElement('b');
  late.setAttribute('slot', 'i');
  late.textContent = 'IN';
  element.append(late);
  await settle();
  await new Promise((r) => setTimeout(r, 0));

  assert.deepEqual(onInner, ['IN'],
    'the DISPLACED slot fired with the right payload — assignment is independent of rendering, as native');
  assert.equal(inner.assignedNodes()[0], late, 'and the payload is the live node');
  assert.deepEqual(onHost, [],
    'the host heard nothing: detached handles have no tree to bubble through — the stated boundary');
  element.remove();
});

/**
 * **The slot element is an API object, not a position — now a published claim, so pinned.**
 *
 * The README and `llms.txt` tell a shadow user migrating here to reach the slot through `&ref` or
 * `event.target`, and say plainly that `querySelector('slot')` will not find it. That sentence was
 * written because a probe hit it: the obvious first move after switching modes returns null, and
 * silence about it makes the whole slot API look absent. A light host has no second tree, so a
 * rendered `<slot>` would be a real element in the user's own DOM — shifting `:nth-child`, matching
 * their selectors — which is why it stays out and why this is a contract rather than an oversight.
 */
test('the slot element is unreachable by selector and reports itself disconnected', async () => {
  const element = host('<b slot="h">ONE</b>');
  let held = null;
  renderInto(html`<header><slot name="h" &ref=${(node) => { held = node; }}>fb</slot></header>`, element);
  await settle();

  assert.equal(held?.localName, 'slot', 'CONTROL: the ref did hand over a slot element');
  assert.equal(element.querySelector('slot'), null, 'and it is not in the host — no selector reaches it');
  assert.equal(held.isConnected, false, 'it reports itself out of the document, honestly');
  assert.deepEqual(held.assignedNodes().map((n) => n.textContent), ['ONE'],
    'while still answering as the live API object the bindings attached to');
  element.remove();
});

/**
 * **The displaced case, which is the other place the fallback lives.**
 *
 * When the OUTER slot has an assignment its fallback is not rendered — and `fill` displaces it node
 * by node, anchors included, so the inner binding has no region to read. The platform still answers
 * for that inner slot, because in a shadow tree it never left the tree at all; only its rendering
 * stopped. So the restore list is the record here, and the discriminator is that `_start` has no
 * parent — no flag, no bookkeeping to fall out of step.
 *
 * This is the case a live-region read alone gets wrong, and it is worth its own test because the
 * first fix for the staleness above passed everything else and silently returned nothing here.
 */
test('a slot displaced inside another slot\'s fallback still reports its own fallback', async () => {
  const element = host('<u slot="o">OUT</u>');
  let inner = null;
  renderInto(
    html`<header><slot name="o"><slot name="i" &ref=${(node) => { inner = node; }}>DEEP</slot></slot></header>`,
    element
  );
  await settle();
  assert.deepEqual(element.querySelector('header').textContent, 'OUT',
    'CONTROL: the outer slot is assigned, so its fallback — the inner slot — is not rendered');
  assert.deepEqual(inner.assignedNodes(), [], 'the inner slot has no assignment');
  assert.deepEqual(inner.assignedNodes({ flatten: true }).map((n) => n.textContent), ['DEEP'],
    'and flattening it still reports its own fallback, as a shadow tree does');
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
 * the component's definition is already registered. This test used to pin the "must name its slot"
 * rule as documented behaviour, with a comment explaining why a diagnostic could not tell the
 * user's bare text from the component's own rendered output.
 *
 * The ownership stamp is what the diagnostic could not be: the component's output arrives through
 * the same callback, but STAMPED — a non-enumerable property written by the renderer for
 * everything it emits at a host's top level, `true` for a root part's own render (the structural
 * `_end === null` test, so an async directive's late commit is covered too) and the placing part
 * for content from an outer template. The ambiguity the old rule existed to avoid is gone, so the
 * rule is gone: bare text and attribute-less elements land in the default slot, exactly as a
 * shadow root would assign them.
 */
test('children appended AFTER the first render land with native semantics, bare text included', async () => {
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
  assert.equal(element.querySelector('main').textContent, 'bare text',
    'bare text lands too — the stamp tells it apart from the component\'s own DOM, which no rule could');

  /** `slot=""` still routes; it is a door, no longer the only one. */
  const explicit = doc.createTextNode('explicit');
  const carrier = doc.createElement('span');
  carrier.setAttribute('slot', '');
  carrier.append(explicit);
  element.append(carrier);
  await settle();
  assert.equal(element.querySelector('main').textContent, 'bare textexplicit', '`slot=""` reaches the default slot');
  element.remove();
});

/**
 * **`slotted()` against a CLOSED shadow root.** `element.shadowRoot` is null there, so reading only
 * that returned `[]` — a silent wrong answer from an accessor documented as answering in either
 * mode, and the same shape as a bug core's own `init` comment records ("read `element.shadowRoot`,
 * found null, and fell back"). Core keeps the root it attached in both modes and exempts `_root`
 * from mangling so other bundles can read it; `@verajs/styles` already does, for this reason.
 *
 * Runs in production too, which is the half that matters: this bundle mangles `_[a-z]` properties
 * and core's does not mangle that one, so the access has to be QUOTED to survive as the same name.
 */
test('slotted() reads a CLOSED shadow root, not just an open one', async () => {
  const tag = `closed-slot-${Math.random().toString(36).slice(2, 8)}`;
  customElements.define(
    tag,
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this, { mode: 'closed' });
        render(() => html`<header><slot name="h">fallback</slot></header>`);
      }
    }
  );
  const element = doc.createElement(tag);
  const supplied = doc.createElement('b');
  supplied.setAttribute('slot', 'h');
  supplied.textContent = 'CLOSED';
  element.append(supplied);
  doc.body.append(element);
  await settle();

  assert.equal(element.shadowRoot, null, 'CONTROL: a closed root really is unreachable that way');
  assert.deepEqual(slotted(element, 'h'), [supplied], 'and slotted() finds the assignment anyway');
  assert.deepEqual(slotted(element), [], 'a slot that does not exist still answers empty');
  element.remove();
});

/**
 * **A rendered light component cannot be cloned, and this pins why.** `cloneNode(true)` copies the
 * host's children, which after a render are the component's own output with the user's slotted
 * nodes already distributed into it — so the clone captures all of that as its own slot content.
 * Nothing can tell those children apart from user content (the same ambiguity as the late-children
 * rule), and the original source was consumed at the first render, so there is nothing to recover.
 *
 * Asserted as behaviour so the docs stay true, and because anything that duplicates components as
 * an operation — an editor canvas, a repeater — has to clone the SOURCE markup instead.
 */
test('cloning a RENDERED host captures its own output — clone the source markup instead', async () => {
  const element = host('<b slot="h">MINE</b>body');
  renderInto(html`<header><slot name="h">fb</slot></header><main><slot>none</slot></main>`, element);
  await settle();
  assert.equal(element.querySelector('header').textContent, 'MINE', 'CONTROL: the original distributed');

  const clone = element.cloneNode(true);
  doc.body.append(clone);
  renderInto(html`<header><slot name="h">fb</slot></header><main><slot>none</slot></main>`, clone);
  await settle();

  assert.equal(clone.querySelector('header').textContent, 'fb',
    "the clone's named slot falls back — the user's node is no longer a direct child of it");
  assert.ok(clone.querySelector('main header'),
    "and the ORIGINAL's rendered tree is now inside the clone's default slot, which is the tell");
  element.remove();
  clone.remove();
});

/**
 * **A `<slot>` inside another slot's FALLBACK.** Legal markup — a fallback that itself defers to
 * another slot — and it threw a TypeError straight out of `renderInto`, taking the whole render
 * with it. Slots mount in document order, so taking over the outer one lifts its fallback children
 * out of the tree; when the outer has an assignment that fallback stays detached, and the inner
 * slot then had no parent to insert anchors into.
 *
 * Declining a parentless slot fixes the crash, and the four static arrangements then read exactly
 * as the platform does — including the one that looks least likely, where the outer falls back and
 * the inner distributes from inside it.
 */
const NESTED_FALLBACK = '<p><slot name="a"><slot name="b">inner-fb</slot></slot></p>';
const nestedTemplate = () => ({
  strings: Object.assign([NESTED_FALLBACK], { raw: [NESTED_FALLBACK] }),
  values: [],
});

/**
 * What a shadow root SHOWS for this shape, flattened by hand. `shadowRoot.textContent` is the wrong
 * instrument and was the first one used here: it reads the slot elements' own fallback children and
 * never the assigned light nodes, so it answers `inner-fb` no matter what is assigned.
 */
const nativeShows = (shadowHost) => {
  const outer = shadowHost.shadowRoot.querySelector('slot[name="a"]');
  const assignedOuter = outer.assignedNodes();
  if (assignedOuter.length > 0) return assignedOuter.map((node) => node.textContent).join('');
  const inner = shadowHost.shadowRoot.querySelector('slot[name="b"]');
  const assignedInner = inner.assignedNodes();
  return assignedInner.length > 0 ? assignedInner.map((node) => node.textContent).join('') : inner.textContent;
};

for (const [label, markup, expected] of [
  ['inner only', '<i slot="b">B</i>', 'B'],
  ['outer only', '<i slot="a">A</i>', 'A'],
  ['both', '<i slot="a">A</i><i slot="b">B</i>', 'A'],
  ['neither', '', 'inner-fb'],
])
  test(`a slot inside a slot's fallback: ${label} — matches the platform`, async () => {
    const shadowHost = host(markup);
    shadowHost.attachShadow({ mode: 'open' }).innerHTML = NESTED_FALLBACK;
    const native = nativeShows(shadowHost);

    const lightHost = host(markup);
    renderInto(nestedTemplate(), lightHost);
    await settle();

    assert.equal(lightHost.querySelector('p').textContent, expected);
    assert.equal(lightHost.querySelector('p').textContent, native, 'and the platform agrees');
    shadowHost.remove();
    lightHost.remove();
  });

/**
 * **A slot revealed inside a fallback takes over at that moment — the platform does the same.**
 *
 * This used to be the one arrangement that diverged, and it was documented as a limit before the
 * cause was understood: the renderer hands slots over in document order, so the outer one detached
 * its fallback children — the inner slot among them — before that slot's turn came, leaving it
 * parentless and declined. It then sat there as a literal `<slot>` showing its own children.
 *
 * The slots module now takes over a slot's nested slots BEFORE extracting its fallback, deepest
 * first, while they still have a parent. Binding order stays tree order, which is what decides
 * duplicate names, and the renderer's later visit finds them parentless and declines as before, so
 * nothing is taken over twice.
 *
 * The platform's answer was measured by LAYOUT, not by reading the tree: with the outer slot
 * assigned the inner content has no box, and once that assignment goes it gains one. Three separate
 * attempts to read this with `textContent`/`innerText` all said "nothing" — those do not cross a
 * shadow boundary, so slotted content is invisible to them, and each time it looked like a defect.
 */
test('a slot revealed inside a fallback distributes, as the platform does', async () => {
  const lightHost = host('<i slot="a">A</i><i slot="b">B</i>');
  renderInto(nestedTemplate(), lightHost);
  await settle();
  assert.equal(lightHost.querySelector('p').textContent, 'A', 'CONTROL: it starts showing the outer assignment');

  lightHost.querySelector('i[slot="a"]').remove();
  await settle();

  assert.equal(lightHost.querySelector('p').textContent, 'B',
    "the inner slot's assignment, not its fallback — the platform renders this too");
  assert.deepEqual(slotted(lightHost, 'b').map((node) => node.textContent), ['B'],
    'and it is a live binding, not a one-off insertion');
  lightHost.remove();
});
