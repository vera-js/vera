/**
 * Documented features in **combination** — which is where an app lives and where per-feature suites
 * do not look.
 *
 * Pass 95's lens was mechanical, in the shape pass 94 used for bundles: build the matrix of feature
 * pairs and find the cells no test file covers. Fifteen pairs had never appeared together. Most are
 * uninteresting; these are the ones where the two features make claims about the *same* node, and
 * where one getting it wrong is invisible in either feature's own tests.
 *
 * The `spread + hydrate` case is here because pass 94 verified it with a throwaway probe and said in
 * its commit message that it was "now asserted rather than assumed" — which it was not, because the
 * probe was deleted. The matrix caught that on the next pass, which is the argument for the matrix.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'Event', 'CSSStyleSheet', 'MutationObserver'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto, hold } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');
const { slots, slotted } = await load('renderer/slots');
const { html } = core;
/** The RENDERER has to be wired too, not just the module: the seam is resolved from the registry
 *  `connect()` hands the renderer, so wiring slots alone leaves it with nowhere to look. Caught by
 *  the CONTROL assertions below — a list of fallbacks reorders just as convincingly as real
 *  content, so without them these tests would have passed while distributing nothing. */
core.wire([await load('renderer').then((m) => m.renderer), slots]);
/** Observer callbacks are microtasks; a macrotask hop settles a pending batch. */
const settle = () => new Promise((resolve) => dom.window.setTimeout(resolve, 0));
const div = () => dom.window.document.createElement('div');

test('spread + hydrate: bindings apply to the adopted node, and updates keep it', () => {
  const host = div();
  host.innerHTML = '<b title="keep" id="a1" data-k="v1">x</b>';
  const server = host.querySelector('b');
  server.dataset.probe = 'survived';

  const draw = (n) => html`<b title="keep" ${spread({ id: `a${n}`, 'data-k': `v${n}`, '.lang': `l${n}` })}>x</b>`;
  hydrateInto(draw(1), host);
  const adopted = host.querySelector('b');
  assert.equal(adopted, server, 'adoption did not keep the server node');
  assert.equal(adopted.dataset.probe, 'survived', 'out-of-band state on the adopted node was lost');
  assert.equal(adopted.getAttribute('title'), 'keep', 'the static beside the spread was dropped');
  assert.equal(adopted.lang, 'l1', 'a spread property binding did not apply');

  hydrateInto(draw(2), host);
  assert.equal(host.querySelector('b'), server, 'the update replaced the node instead of mutating it');
  assert.equal(adopted.getAttribute('data-k'), 'v2');
  assert.equal(adopted.lang, 'l2');
});

test('ref + hydrate: the ref receives the server node, not a fresh one', () => {
  const host = div();
  host.innerHTML = '<input value="server">';
  const server = host.querySelector('input');
  const reference = core.ref(null);
  hydrateInto(html`<input value="server" ${reference} />`, host);
  assert.equal(reference.value, server, 'the ref got a node the page is not showing');
});

/**
 * The documented reason adoption *records* a form value rather than writing it: the page is usable
 * before the bundle lands, and the window between the two is where someone types. Writing the
 * binding then would throw that away silently on every hydrating page.
 */
test('!live + hydrate: what a person typed survives adoption, and a real change still lands', () => {
  const host = div();
  host.innerHTML = '<input value="from-server">';
  host.querySelector('input').value = 'typed by a person';

  const draw = (value) => html`<input !value=${value} />`;
  hydrateInto(draw('from-server'), host);
  assert.equal(host.querySelector('input').value, 'typed by a person',
    'adoption overwrote what the user had already typed');

  hydrateInto(draw('from-state'), host);
  assert.equal(host.querySelector('input').value, 'from-state',
    'the binding stayed inert after adoption instead of staying live');
});

test('hold + hydrate: a held subtree survives a toggle away and back', () => {
  const host = div();
  host.innerHTML = '<div><p>a</p></div>';
  const draw = (on) => html`<div>${hold(on ? html`<p>${'a'}</p>` : html`<b>${'b'}</b>`)}</div>`;
  hydrateInto(draw(true), host);
  const first = host.querySelector('p');
  hydrateInto(draw(false), host);
  hydrateInto(draw(true), host);
  assert.equal(host.querySelector('p'), first, 'hold rebuilt the subtree it exists to preserve');
});

/**
 * A keyed **move** must not look like a teardown. Refs are released on teardown — that is what stops
 * a detached node being handed back — so a reorder that released them would break every ref in a
 * sortable list, and a removal that failed to release one would keep a detached node alive.
 */
test('keyed + ref: a reorder keeps every ref, a removal releases exactly one', () => {
  const refs = { a: core.ref(null), b: core.ref(null), c: core.ref(null) };
  const host = div();
  const draw = (order) =>
    renderInto(html`<ul>${order.map((id) => keyed(id, html`<li data-id=${id} ${refs[id]}>${id}</li>`))}</ul>`, host);

  draw(['a', 'b', 'c']);
  const nodes = Object.fromEntries(['a', 'b', 'c'].map((id) => [id, host.querySelector(`li[data-id="${id}"]`)]));
  for (const id of ['a', 'b', 'c']) assert.equal(refs[id].value, nodes[id], `${id} did not get its node`);

  draw(['c', 'b', 'a']);
  for (const id of ['a', 'b', 'c']) {
    assert.equal(host.querySelector(`li[data-id="${id}"]`), nodes[id], `${id} was rebuilt by a reorder`);
    assert.equal(refs[id].value, nodes[id], `${id}'s ref was released by a reorder`);
  }

  draw(['c', 'a']);
  assert.equal(refs.b.value, null, "the removed row's ref was not released — it holds a detached node");
  assert.equal(refs.a.value, nodes.a, 'a surviving ref was released by an unrelated removal');
  assert.equal(refs.c.value, nodes.c);

  draw([]);
  assert.equal(refs.a.value, null);
  assert.equal(refs.c.value, null);
});

/**
 * **slots + keyed.** A keyed list REORDERS and REMOVES the DOM that slot bindings live in, and a
 * keyed move must not look like a teardown — the same distinction the refs case above turns on. If
 * a move parked the binding, the user's slotted node would be pulled back into holding and the row
 * would render its fallback; if a removal did NOT park, the node would be discarded with the row.
 */
test('slots + keyed: rows carry their slotted content through a reorder, and give it back on removal', async () => {
  const host = div();
  host.innerHTML = '<b slot="s1">ONE</b><i slot="s2">TWO</i>';
  dom.window.document.body.appendChild(host);
  const rows = (order) => html`<ul>${order.map((id) =>
    keyed(id, html`<li data-id=${id}><slot name=${'s' + id}>fb${id}</slot></li>`))}</ul>`;

  renderInto(rows([1, 2]), host);
  await settle();
  const one = host.querySelector('b');
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['ONE', 'TWO'],
    'CONTROL: both rows distributed');

  renderInto(rows([2, 1]), host);
  await settle();
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['TWO', 'ONE'],
    'a keyed MOVE must not read as a teardown — the content moved with its row');
  assert.equal(host.querySelector('b'), one, 'as the same node');

  renderInto(rows([2]), host);
  await settle();
  assert.deepEqual([...host.querySelectorAll('li')].map((li) => li.textContent), ['TWO']);
  assert.deepEqual(slotted(host, 's1').map((n) => n.textContent), ['ONE'],
    'a keyed REMOVAL must park rather than discard — the node is captured, waiting');

  renderInto(rows([1, 2]), host);
  await settle();
  assert.equal(host.querySelector('b'), one, 'and the very same node comes back when its row does');
  host.remove();
});

/**
 * **slots + hold.** `hold` retains a subtree across renders instead of rebuilding it. The slot
 * binding inside must be retained with it — rebuilt anchors would re-park and re-fill, which is
 * visible as churn even when the result looks the same.
 */
test('slots + hold: a held subtree keeps its slot binding and the node inside it', async () => {
  const host = div();
  host.innerHTML = '<b slot="h">HELD</b>';
  dom.window.document.body.appendChild(host);
  const draw = (n) => html`<section>${hold(html`<div><slot name="h">fb</slot></div>`)}<footer>${n}</footer></section>`;

  renderInto(draw(1), host);
  await settle();
  const node = host.querySelector('b');
  assert.equal(host.querySelector('div').textContent, 'HELD', 'CONTROL: distributed inside the held subtree');

  renderInto(draw(2), host);
  await settle();
  assert.equal(host.querySelector('footer').textContent, '2', 'CONTROL: the render around it did update');
  assert.equal(host.querySelector('div').textContent, 'HELD');
  assert.equal(host.querySelector('b'), node, 'the held subtree kept the very same slotted node');
  host.remove();
});

/**
 * autoloader + slots: a lazy tag that enters the world inside DISPLACED slot content. Parking
 * moves the user's nodes into a detached fragment outside every observed tree, so nothing may
 * load while displaced — and the restore re-enters the autoloader's subtree, where discovery MUST
 * fire or a lazy component in a toggled-away branch never appears. Discovery in jsdom needs the
 * suite-standard `:not(:defined)` emulation (jsdom lacks the selector; the browser autoloader
 * suite owns real discovery) and the `autoloader` attribute on the host (`watch()` returns early
 * without it — both are the recorded probe traps, walked into again finding this).
 */
test('autoloader + slots: parked content stays dormant, restored content loads', async () => {
  const origQSA = dom.window.Element.prototype.querySelectorAll;
  dom.window.Element.prototype.querySelectorAll = function (sel) {
    if (sel === ':not(:defined)')
      return [...origQSA.call(this, '*')].filter(
        (el) => el.localName.includes('-') && !dom.window.customElements.get(el.localName)
      );
    return origQSA.call(this, sel);
  };
  try {
    const { autoloader } = await load('autoloader');
    const rootDir = new URL('./fixtures/autoloader/entry.js', import.meta.url).href;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 60));

    const host = div();
    host.setAttribute('autoloader', '');
    dom.window.document.body.append(host);
    autoloader(rootDir, 'components')(host);

    const drawSlot = () => html`<div><slot name="o">fall</slot></div>`;
    const drawAway = () => html`<p>away</p>`;

    const early = dom.window.document.createElement('u');
    early.setAttribute('slot', 'o');
    early.innerHTML = '<probe-widget></probe-widget>';
    host.append(early);
    renderInto(drawSlot(), host);
    await tick();
    assert.ok((globalThis.__loads ?? 0) >= 1 && dom.window.customElements.get('probe-widget'),
      'CONTROL: assigned slot content autoloads at all');

    renderInto(drawAway(), host);
    await tick();
    const holder = dom.window.document.createElement('b');
    holder.innerHTML = '<lazy-widget></lazy-widget>';
    early.append(holder);
    await tick();
    assert.equal(early.isConnected, false, 'CONTROL: the content is genuinely parked');
    assert.equal(globalThis.__lazyLoads ?? 0, 0, 'nothing may load from a detached fragment');

    renderInto(drawSlot(), host);
    await tick();
    await tick();
    assert.equal(globalThis.__lazyLoads, 1, 'the restore was discovered and loaded exactly once');
    assert.equal(host.querySelector('lazy-widget')?.textContent, 'lazy-loaded',
      'defined, upgraded, and rendered after the roundtrip');
    host.remove();
  } finally {
    dom.window.Element.prototype.querySelectorAll = origQSA;
  }
});

/**
 * keyed + spread: rows whose element carries a runtime bag, through a reorder and a removal. The
 * two features claim the same node from different directions — keyed moves it by identity, spread
 * keys its Binding map on the part — so the cells worth pinning are the ones where a stale
 * mapping would show: attributes riding along a move, a handler still routed AFTER the move, a
 * bag update landing on a moved row, and removal taking the row's bindings with the row. (A
 * detached row's listener still firing on a direct dispatch is the platform's own rule and the
 * documented parity with written `@event` — not asserted as a defect here.)
 */
test('keyed + spread: bags ride reorders, update in place, and leave with their row', () => {
  const host = div();
  dom.window.document.body.append(host);
  const clicks = [];
  const row = (r) => keyed(r.id, html`<li ${spread({ 'data-k': r.id, title: r.t, '@click': () => clicks.push(r.id) })}>${r.id}</li>`);
  const draw = (rows) => renderInto(html`<ul>${rows.map(row)}</ul>`, host);

  draw([{ id: 'a', t: '1' }, { id: 'b', t: '2' }, { id: 'c', t: '3' }]);
  const [ea, eb, ec] = host.querySelectorAll('li');
  assert.ok(ea.getAttribute('data-k') === 'a' && ec.title === '3', 'CONTROL: the bags landed at all');
  ea.dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks.join(), 'a', 'CONTROL: the handler fires at all');

  draw([{ id: 'c', t: '3' }, { id: 'a', t: '1' }, { id: 'b', t: '2' }]);
  const after = [...host.querySelectorAll('li')];
  assert.ok(after[0] === ec && after[1] === ea && after[2] === eb, 'the reorder moved nodes, never rebuilt');
  assert.equal(after.map((n) => n.getAttribute('data-k')).join(), 'c,a,b', 'attributes rode their rows');
  after[1].dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks.join(), 'a,a', 'the handler is still routed to the MOVED row');

  draw([{ id: 'c', t: '9' }, { id: 'a', t: '1' }, { id: 'b', t: '2' }]);
  assert.equal(host.querySelector('li').title, '9', 'a bag update lands on a moved row');

  draw([{ id: 'c', t: '9' }, { id: 'b', t: '2' }]);
  assert.equal(host.contains(ea), false, 'removal took the row');
  assert.equal(host.querySelectorAll('li').length, 2);
  host.remove();
});

/**
 * styles + hold: a component with `static styles` parked and restored, five cycles. The two
 * features share once-per-class bookkeeping from different directions — hold preserves the
 * element (so connectedCallback re-runs on every restore) while styles must adopt a shadow
 * sheet once and hoist a light sheet once — so the cells worth pinning are the counters after
 * churn: one sheet in the root, one hoisted style in the head, however many times the branch
 * toggles. Content is read off the inner <p>, never the root — under jsdom the root carries the
 * <style> ELEMENT and textContent would include the CSS (the probe artifact that found this
 * test its shape).
 */
test('styles + hold: five park/restore cycles adopt once and hoist once', async () => {
  const { css, init, render } = core;
  const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    core.wire([await load('styles').then((m) => m.styles)]);
    customElements.define('fc-styled-shadow', class extends dom.window.HTMLElement {
      static styles = css`.inner { color: rgb(1, 2, 3); }`;
      connectedCallback() { init(this, { mode: 'open' }); render(() => html`<p class="inner">shadow</p>`); }
    });
    customElements.define('fc-styled-light', class extends dom.window.HTMLElement {
      static styles = css`.lt { color: rgb(4, 5, 6); }`;
      connectedCallback() { init(this); render(() => html`<p class="lt">light</p>`); }
    });
    const host = div();
    dom.window.document.body.append(host);
    const branch = (on) => renderInto(
      html`<div>${hold(on ? html`<fc-styled-shadow></fc-styled-shadow><fc-styled-light></fc-styled-light>` : html`<p>away</p>`)}</div>`, host);

    branch(true); await frame();
    const shadowEl = host.querySelector('fc-styled-shadow');
    const lightEl = host.querySelector('fc-styled-light');
    const sheets = () => shadowEl.shadowRoot.adoptedStyleSheets?.length || shadowEl.shadowRoot.querySelectorAll('style').length;
    const hoisted = () => dom.window.document.head.querySelectorAll('style').length;
    const s0 = sheets(); const h0 = hoisted();
    assert.ok(s0 >= 1 && shadowEl.shadowRoot.querySelector('p').textContent === 'shadow', 'CONTROL: styled and rendered');

    for (let i = 0; i < 5; i++) { branch(false); await frame(); branch(true); await frame(); }
    assert.equal(host.querySelector('fc-styled-shadow'), shadowEl, 'hold kept the shadow element');
    assert.equal(host.querySelector('fc-styled-light'), lightEl, 'and the light one');
    assert.equal(sheets(), s0, 'the shadow sheet was adopted once, not per restore');
    assert.equal(hoisted(), h0, 'the light hoist happened once, not per restore');
    assert.equal(shadowEl.shadowRoot.querySelector('p').textContent, 'shadow');
    assert.equal(lightEl.querySelector('p').textContent, 'light');
    host.remove();
  } finally {
    console.warn = realWarn;
  }
});

/**
 * collections + keyed: a keyed list driven straight off a reactive Map. The Map notifies through
 * the 'collection' insert while keyed moves rows by identity, so the cells worth pinning are the
 * mutations where those two accounts of "what changed" could disagree: a value set updates the
 * row IN PLACE, a delete removes exactly its row, an add appends without touching siblings, and a
 * clear-plus-reinsert in reversed order MOVES the surviving rows (identity held) — with the whole
 * clear+reinsert batch coalescing to one render, which is the scheduler's promise carried through
 * the collection trap.
 */
test('collections + keyed: map mutations move rows by identity, batches coalesce', async () => {
  const { init, render, createStore } = core;
  core.wire([await load('reactivity/collections').then((m) => m.collections)]);
  /**
   * This file's globals deliberately omit `requestAnimationFrame`, so the scheduler runs its
   * synchronous fallback — under which a clear() RENDERS the empty list before the reinserts
   * land, and the rebuild that follows is correct behavior, not a keyed defect. This test is
   * ABOUT coalescing, so it installs the frame scheduler for its own duration (CLAUDE.md's first
   * probe rule, met from the other side: the probe had the global, the suite did not, and the
   * disagreement read exactly like an identity bug for one bisect).
   */
  const hadRaf = 'requestAnimationFrame' in globalThis;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
  const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
  let renders = 0;
  customElements.define('fc-map-list', class extends dom.window.HTMLElement {
    connectedCallback() {
      init(this);
      this.store = createStore({ rows: new Map([['a', 1], ['b', 2], ['c', 3]]) });
      render(() => { renders++; return html`<ul>${[...this.store.rows.entries()].map(([k, v]) => keyed(k, html`<li>${k}=${v}</li>`))}</ul>`; });
    }
  });
  const el = dom.window.document.createElement('fc-map-list');
  dom.window.document.body.append(el);
  await frame();
  const [la, lb, lc] = el.querySelectorAll('li');
  assert.equal(el.textContent, 'a=1b=2c=3', 'CONTROL: the map rendered at all');

  el.store.rows.set('b', 9); await frame();
  assert.ok(el.querySelectorAll('li')[1] === lb && lb.textContent === 'b=9', 'a set updates its row in place');

  el.store.rows.delete('a'); await frame();
  assert.ok(!el.contains(la) && el.contains(lb) && el.contains(lc), 'a delete removes exactly its row');

  el.store.rows.set('d', 4); await frame();
  assert.equal(el.textContent, 'b=9c=3d=4', 'an add appends');

  const before = renders;
  const entries = [...el.store.rows.entries()].reverse();
  el.store.rows.clear();
  for (const [k, v] of entries) el.store.rows.set(k, v);
  await frame();
  const after = [...el.querySelectorAll('li')];
  assert.equal(el.textContent, 'd=4c=3b=9', 'clear + reversed reinsert lands the new order');
  assert.ok(after[1] === lc && after[2] === lb, 'and the surviving rows MOVED — identity, not rebuild');
  assert.equal(renders, before + 1, 'the whole clear+reinsert batch coalesced to one render');
  el.remove();
  if (!hadRaf) { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
});

/**
 * hold + keyed: every row of a list shares hold's CALL SITE, which is the phrase the README keys
 * adoption on — so the cell worth pinning is that rows never adopt each other's parked state.
 * The cache rides each row's own part; this is what makes that fact enforced rather than
 * incidental. Typed values name their owner, so a cross-adoption cannot pass as a lookalike, and
 * the reorder-while-parked step is included because moving rows is exactly when part↔row pairing
 * could slip.
 */
test('hold + keyed: rows share the call site and never each other\'s parked state', () => {
  const row = (r) => keyed(r.id, html`<li>${hold(r.editing ? html`<input class="ed" data-row=${r.id} />` : html`<span>view-${r.id}</span>`)}</li>`);
  const host = div();
  dom.window.document.body.append(host);
  const draw = (rows) => renderInto(html`<ul>${rows.map(row)}</ul>`, host);

  draw([{ id: 'A', editing: true }, { id: 'B', editing: true }]);
  const [inA, inB] = host.querySelectorAll('input');
  inA.value = 'typed-in-A'; inB.value = 'typed-in-B';

  draw([{ id: 'A', editing: false }, { id: 'B', editing: true }]);
  assert.ok(host.textContent.includes('view-A'), 'CONTROL: A really toggled away');
  assert.equal(host.querySelector('input'), inB, 'B kept its own editor while A parked');

  draw([{ id: 'A', editing: true }, { id: 'B', editing: true }]);
  const eds = [...host.querySelectorAll('input')];
  assert.equal(eds[0], inA, 'A re-adopted ITS editor, not B\'s');
  assert.equal(eds[0].value, 'typed-in-A', 'with A\'s typed state');
  assert.equal(eds[1].value, 'typed-in-B', 'and B\'s untouched');

  draw([{ id: 'A', editing: false }, { id: 'B', editing: true }]);
  draw([{ id: 'B', editing: true }, { id: 'A', editing: false }]);
  draw([{ id: 'B', editing: true }, { id: 'A', editing: true }]);
  const after = [...host.querySelectorAll('input')];
  assert.deepEqual(after.map((e) => `${e.getAttribute('data-row')}:${e.value}`),
    ['B:typed-in-B', 'A:typed-in-A'],
    'a reorder while one row was parked still returns each state to its owner');
  host.remove();
});

/**
 * computed + untrack inside one component render: the two subscription MODIFIERS composing with
 * per-key render granularity. The cells that could disagree: a dep write must cost exactly one
 * re-render and one re-evaluation (a computed that subscribes the component to its inputs twice
 * doubles either count); an untracked read must cost zero re-renders when written — while still
 * refreshing INCIDENTALLY on the next legitimate render, which is untrack's documented meaning
 * ("read without subscribing", not "freeze"); and an unrelated key stays free. Store-driven, so
 * the frame scheduler is installed for the test's duration (this file's globals omit rAF).
 */
test('computed + untrack: one render per dep write, none per untracked write', async () => {
  const { init, render, createStore, untrack } = core;
  const { computed } = await load('reactivity');
  const hadRaf = 'requestAnimationFrame' in globalThis;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
  const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    let renders = 0, evals = 0;
    customElements.define('fc-calc-view', class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this);
        this.store = createStore({ items: [3, 4], noise: 0, unrelated: 'x' });
        this.total = computed(() => { evals++; return this.store.items.reduce((n, v) => n + v, 0); });
        render(() => {
          renders++;
          const n = untrack(() => this.store.noise);
          return html`<b>total=${this.total.value} noise=${n}</b>`;
        });
      }
    });
    const el = dom.window.document.createElement('fc-calc-view');
    dom.window.document.body.append(el);
    await frame();
    assert.equal(el.textContent, 'total=7 noise=0', 'CONTROL: rendered at all');

    el.store.items.push(5); await frame();
    assert.ok(renders === 2 && evals === 2 && el.textContent.includes('total=12'),
      'a dep write costs exactly one render and one evaluation');

    el.store.noise = 99; await frame();
    assert.equal(renders, 2, 'an untracked write costs nothing');
    assert.ok(el.textContent.includes('noise=0'), 'and the screen holds the stale read, by design');

    el.store.unrelated = 'y'; await frame();
    assert.ok(renders === 2 && evals === 2, 'an unrelated key stays free');

    el.store.items[0] = 10; await frame();
    assert.ok(renders === 3 && el.textContent.includes('total=19') && el.textContent.includes('noise=99'),
      'the next legitimate render refreshes the untracked value incidentally');
    el.remove();
  } finally {
    if (!hadRaf) { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
  }
});

/**
 * shallowRef + keyed: the documented list-data recipe, composed. The README says use shallowRef
 * for rows and REPLACE rather than mutate; keyed says rows move by identity. The composition's
 * cells: one .value swap costs one render and reconciles by key (a move, an update, an add and a
 * removal in one swap); an INNER mutation renders nothing — shallow means shallow, the screen
 * holds stale by design; and the reassignment escape hatch shows it while identity still holds.
 */
test('shallowRef + keyed: replace reconciles by identity, inner mutation stays invisible', async () => {
  const { init, render, shallowRef } = core;
  const hadRaf = 'requestAnimationFrame' in globalThis;
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame;
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame;
  const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    let renders = 0;
    customElements.define('fc-rows-view', class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this);
        this.rows = shallowRef([{ id: 'a', v: 1 }, { id: 'b', v: 2 }, { id: 'c', v: 3 }]);
        render(() => { renders++; return html`<ul>${this.rows.value.map((r) => keyed(r.id, html`<li>${r.id}:${r.v}</li>`))}</ul>`; });
      }
    });
    const el = dom.window.document.createElement('fc-rows-view');
    dom.window.document.body.append(el);
    await frame();
    const [la, lb, lc] = el.querySelectorAll('li');
    assert.equal(el.textContent, 'a:1b:2c:3', 'CONTROL: rendered at all');

    el.rows.value = [{ id: 'c', v: 3 }, { id: 'a', v: 10 }, { id: 'd', v: 4 }];
    await frame();
    const after = [...el.querySelectorAll('li')];
    assert.equal(renders, 2, 'one render for the whole swap');
    assert.equal(el.textContent, 'c:3a:10d:4');
    assert.ok(after[0] === lc && after[1] === la, 'surviving rows moved by identity');
    assert.equal(la.textContent, 'a:10', 'and updated in place');
    assert.ok(!el.contains(lb), 'the departed row left');

    el.rows.value[0].v = 99;
    await frame();
    assert.equal(renders, 2, 'shallow means shallow: an inner mutation renders nothing');
    assert.ok(el.textContent.includes('c:3'), 'the screen holds the stale value by design');

    el.rows.value = [...el.rows.value];
    await frame();
    assert.ok(el.textContent.includes('c:99'), 'the reassignment escape hatch shows it');
    assert.equal(el.querySelector('li'), lc, 'with identity still held');
    el.remove();
  } finally {
    if (!hadRaf) { delete globalThis.requestAnimationFrame; delete globalThis.cancelAnimationFrame; }
  }
});

/**
 * spread + hold: a runtime bag riding a park/restore. Spread keys its Binding map on the PART and
 * hold re-adopts the same part's instance, so the cells that could disagree are all on the
 * restore side: a changed bag value must land, a DEPARTED key must release (restore is a render,
 * and release-on-departure is spread's contract wherever a render happens), the swapped handler
 * must fire exactly once, and the element — typed value included — must be the parked one. Two
 * roundtrips, because the first restore exercises adopt-after-park and the second exercises
 * park-after-restore.
 */
test('spread + hold: bags update, departed keys release, handlers swap — across park/restore', () => {
  const host = div();
  dom.window.document.body.append(host);
  let clicks = 0;
  const editor = (bag) => html`<input class="ed" ${spread(bag)} />`;
  const draw = (editing, bag) => renderInto(html`<div>${hold(editing ? editor(bag) : html`<p>view</p>`)}</div>`, host);

  draw(true, { title: 't1', 'data-k': 'v1', '@click': () => clicks++ });
  const input = host.querySelector('input');
  input.value = 'typed';
  input.dispatchEvent(new dom.window.Event('click'));
  assert.ok(input.title === 't1' && clicks === 1, 'CONTROL: the bag landed and the handler fires');

  draw(false, {});
  assert.equal(input.isConnected, false, 'parked');

  draw(true, { title: 't2', '@click': () => { clicks += 10; } });
  assert.equal(host.querySelector('input'), input, 'the SAME node returned');
  assert.equal(input.value, 'typed', 'with its typed value');
  assert.equal(input.title, 't2', 'the changed bag value landed on restore');
  assert.equal(input.getAttribute('data-k'), null, 'the departed key released');
  input.dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks, 11, 'the swapped handler fires exactly once');

  draw(false, {});
  draw(true, { '@click': () => { clicks += 100; } });
  assert.equal(input.getAttribute('title'), null, 'second roundtrip: title released too');
  assert.equal(host.querySelector('input'), input, 'identity still held');
  input.dispatchEvent(new dom.window.Event('click'));
  assert.equal(clicks, 111, 'and the handler still routed');
  host.remove();
});
