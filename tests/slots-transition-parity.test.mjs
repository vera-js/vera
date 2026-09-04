/**
 * **Every content-mode transition of `<host>${value}</host>`, light against shadow.**
 *
 * The audit's relocation finding was fixed for LISTS and believed closed; this matrix is what
 * reopened it. A light host's `${…}` child passing through the renderer's other modes hit three
 * interlocking defects, every one invisible until a fresh-host probe compared against shadow:
 *
 * 1. **The upgrade chased the captured node.** A TextPart upgrading after its text was captured
 *    planted markers at `_text.parentNode` — inside the slot — and the slot's next fill swept
 *    them into the holding fragment, leaving the part rendering into detached space for the life
 *    of the page. `text → null → text` showed FALLBACK forever.
 * 2. **Relocated clears only knew about items.** TEMPLATE and NODE modes walked the empty marker
 *    range and removed nothing — `tpl → tpl` (shape change) showed the OLD template forever.
 * 3. **Capture rejected the renderer's own re-renders.** The added-after-first-render rule
 *    demanded a `slot` attribute — right for user appends at the host's tail, wrong for the
 *    renderer's own content, which always lands in the light region before the sentinel.
 *
 * The fixes: a light-region sentinel per host with native capture semantics before it, `_$home$`
 * so upgrades plant markers in the host, identity-based clearing per mode, and keyed's relocated
 * path creating rows between the part's own markers, forward.
 *
 * **Shadow is the oracle, not expected strings**: the same component, the same values, the only
 * difference the `init` argument — so the platform stays the definition and this fails on
 * divergence, not on redesign. Every case runs from a FRESH host: the first probe chained one
 * host through all fourteen states and bug 1 poisoned every later reading, which cost a full
 * misdiagnosis before the contamination was seen.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Text','Comment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','MutationObserver','NodeFilter'])
  globalThis[key] = dom.window[key];

const { init, html, render, wire } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, slots]);

const D = dom.window.document;
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(r));

for (const [tag, mode] of [['t-light', undefined], ['t-shadow', { mode: 'open' }]])
  customElements.define(
    tag,
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this, mode);
        render(() => html`<div class="box"><slot>FALLBACK</slot></div>`);
      }
    }
  );

/** What the component SHOWS — assigned content, or the fallback. Never the representation. */
const shown = (el) => {
  const box = (el.shadowRoot ?? el).querySelector('.box');
  if (el.shadowRoot) {
    const assigned = box.querySelector('slot').assignedNodes();
    return assigned.length
      ? assigned.map((n) => (n.nodeType === 3 ? n.data : `<${n.localName}>${n.textContent}</${n.localName}>`)).join('')
      : 'FALLBACK';
  }
  return (
    [...box.childNodes]
      .map((n) => (n.nodeType === 3 ? n.data : n.nodeType === 1 ? `<${n.localName}>${n.textContent}</${n.localName}>` : ''))
      .join('') || '(empty)'
  );
};

/** One call site per shape (two literals are two templates — CLAUDE.md). */
const tplA = (v) => html`<b>${v}</b>`;
const tplB = (v) => html`<i>${v}</i>`;
const rows = (ids) => ids.map((id) => keyed(id, html`<em>${id}</em>`));
const mkNode = (t) => {
  const n = D.createElement('u');
  n.textContent = t;
  return n;
};

/** Values are FACTORIES where identity per run matters (hold, nodes) — a shadow run must not
 *  consume the node object the light run needs. */
const CASES = [
  ['text updates in place', () => ['a', 'b']],
  ['text through null and back', () => ['a', null, 'c']],
  ['text becomes a template', () => ['a', tplA('t')]],
  ['same-shape template update', () => [tplA('1'), tplA('2')]],
  ['template shape change', () => [tplA('1'), tplB('2')]],
  ['template through null and back', () => [tplA('1'), null, tplA('3')]],
  ['node swap', () => [mkNode('n1'), mkNode('n2')]],
  ['node through null and back', () => [mkNode('n1'), null, mkNode('n3')]],
  ['hold round trip', () => [hold(tplA('h1')), hold(tplB('h2')), hold(tplA('h3'))]],
  ['keyed reorder, default slot', () => [rows(['1', '2']), rows(['2', '1'])]],
  ['keyed grow, default slot', () => [rows(['1']), rows(['1', '2', '3'])]],
  ['keyed insert mid, default slot', () => [rows(['1', '3']), rows(['1', '2', '3'])]],
  ['keyed through null and back', () => [rows(['1']), null, rows(['9'])]],
];

const run = async (tag, values) => {
  const page = D.createElement('div');
  D.body.append(page);
  const draw = (v) => (tag === 't-light' ? html`<t-light>${v}</t-light>` : html`<t-shadow>${v}</t-shadow>`);
  let out = '';
  for (const value of values) {
    renderInto(draw(value), page);
    await frame();
    await frame();
    out = shown(page.querySelector(tag));
  }
  page.remove();
  return out;
};

for (const [label, values] of CASES) {
  test(`light matches shadow: ${label}`, async () => {
    const want = await run('t-shadow', values());
    assert.notEqual(want, '(empty)', 'CONTROL: the oracle rendered nothing, so nothing is compared');
    const got = await run('t-light', values());
    assert.equal(got, want, `light DOM says ${JSON.stringify(got)}, the platform says ${JSON.stringify(want)}`);
  });
}

/**
 * **The two former divergences, now pinned as PARITY.** Both used to be documented limits:
 *
 * A late light-region insertion joined its slot at the END (native: document order). Distribution
 * moves nodes, so position could not answer — but OWNERSHIP can: renderer output and placed
 * content are stamped, so an unstamped node before the boundary is knowably the user's and takes
 * its document position, ahead of content distributed away. Native answers `PREPENDED, Body`;
 * so do we, in CSR and after hydration alike.
 *
 * Appended tail TEXT was unreachable — it cannot carry the `slot` attribute the old tail rule
 * demanded. The rule demanded it because ownership was unknowable; it is stamped now, so the
 * attribute requirement is retired and bare text appends land in the default slot, as native.
 *
 * The residue, stated so this comment cannot overclaim: hand-edits interleaved among SEVERAL
 * `${…}` parts' content in one host order approximately (membership always right). That is the
 * whole remaining gap between light and shadow.
 */
test('a late light-region insertion takes its document position, as native', async () => {
  const page = D.createElement('div');
  D.body.append(page);
  const draw = (v) => html`<t-light>${v}</t-light>`;
  renderInto(draw('Body'), page);
  await frame();
  await frame();
  const host = page.querySelector('t-light');
  assert.equal(shown(host), 'Body', 'CONTROL: the original light content distributed');

  host.insertBefore(D.createTextNode('PREPENDED'), host.firstChild);
  await frame();
  await frame();
  assert.equal(shown(host), 'PREPENDEDBody', 'prepended text precedes distributed content — the native answer');

  /** The tail, both kinds: an element with no attribute at all, and bare text. */
  const named = D.createElement('i');
  named.setAttribute('slot', '');
  named.textContent = 'TAILED';
  host.appendChild(named);
  await frame();
  await frame();
  assert.match(shown(host), /TAILED/, 'slot="" still routes');

  host.appendChild(D.createTextNode('LOOSE'));
  await frame();
  await frame();
  assert.equal(shown(host), 'PREPENDEDBody<i>TAILED</i>LOOSE',
    'appended bare text lands last in the default slot — the hole the attribute rule could never close');
  page.remove();
});

/**
 * **A component's own output is not its content — the two sides of one distinction.**
 *
 * `slots` used to capture any top-level element carrying a `slot` attribute. A component's own
 * rendered root may legitimately be exactly that — content destined for ITS parent's slot — and
 * it was captured and moved into holding, so the component rendered NOTHING. First render, no
 * children needed, nothing thrown. The ownership stamp is the fix, and these two tests are both
 * needed and neither is sufficient: the first says the stamp exists, the second says it means the
 * right thing. Stamping everything the renderer touches would pass the first and fail the second,
 * because in `<host>${node}</host>` the renderer also places the node — the difference is which
 * RENDER it was placing for, which is why the stamp's value is structural (`_end === null`).
 */
test('a component whose own output carries slot= still renders it', async () => {
  customElements.define(
    't-selfslot',
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this); // LIGHT
        render(() => html`<div slot="header" class="box"><slot>FB</slot></div>`);
      }
    }
  );
  const host = D.createElement('t-selfslot');
  host.append(D.createTextNode('A'));
  D.body.append(host);
  renderInto(html`<div slot="header" class="box"><slot>FB</slot></div>`, host);
  await frame();
  await frame();
  assert.ok(host.querySelector('.box'), 'the component rendered its own output at all');
  assert.equal(host.querySelector('.box').textContent, 'A', 'and it still distributes the host content');
  host.remove();
});

test('but content the renderer places INTO a host is still the user\'s', async () => {
  const page = D.createElement('div');
  D.body.append(page);
  const draw = (v) => html`<t-light>${v}</t-light>`;
  const canvas = D.createElement('canvas');
  renderInto(draw(canvas), page);
  await frame();
  await frame();
  assert.equal(shown(page.querySelector('t-light')), '<canvas></canvas>',
    'a node placed by an outer render is content, not output');

  const video = D.createElement('video');
  renderInto(draw(video), page);
  await frame();
  await frame();
  assert.equal(shown(page.querySelector('t-light')), '<video></video>', 'and it swaps like any other value');
  page.remove();
});

/**
 * **The last residue, closed: a hand-edit BETWEEN two parts' groups lands between them.**
 *
 * Distribution moves content out of the host, but the part markers never move — they are the
 * light tree's surviving skeleton, and the capture walk indexes them (comment → the member
 * captured next). An unstamped insertion walks forward to the nearest recorded comment and goes
 * before that member: exact placement where the positional scan could only answer "ahead of
 * everything distributed". Verified before building that a part keeps the SAME marker nodes
 * across template-identity rebuilds, so the index cannot churn.
 *
 * What remains below this is only: two USER nodes inserted into the SAME inter-marker gap at
 * different times tie-break arbitrarily between themselves. There is no information left
 * anywhere to order them — the reference each "meant" no longer exists.
 */
test('a hand-edit between two parts\' content lands between their groups, as native', async () => {
  const tplA = (v) => html`<em>${v}</em>`;
  const tplB = (v) => html`<strong>${v}</strong>`;
  const run = async (tag) => {
    const page = D.createElement('div');
    D.body.append(page);
    const draw = (a, b) =>
      tag === 't-light' ? html`<t-light>${tplA(a)}${tplB(b)}</t-light>` : html`<t-shadow>${tplA(a)}${tplB(b)}</t-shadow>`;
    renderInto(draw('A', 'B'), page);
    await frame();
    await frame();
    const host = page.querySelector(tag);
    const U = D.createTextNode('U');
    if (host.shadowRoot) host.insertBefore(U, host.querySelector('strong'));
    else {
      /** The user's gesture: insert before b's marker run — the nodes still standing in the host. */
      const comments = [...host.childNodes].filter((n) => n.nodeType === 8);
      host.insertBefore(U, comments[2] ?? null);
    }
    await frame();
    await frame();
    const out = shown(host);
    page.remove();
    return out;
  };
  const want = await run('t-shadow');
  assert.equal(want, '<em>A</em>U<strong>B</strong>', 'CONTROL: native puts U between the groups');
  assert.equal(await run('t-light'), want, 'and so do we — placed against the marker skeleton');
});

/**
 * **The parser case — the reason the retired rule bit more often than its wording suggested.**
 *
 * When a component's definition is already registered (an inline module above the markup, a
 * streamed document), the HTML parser upgrades and renders the element BEFORE it has read the
 * children, which then arrive one at a time. Under the old rule bare text in that stream was
 * simply lost, and the docs described the timing as the trigger. They now promise it works, so
 * this holds them to it — chunk by chunk, mixed text and elements, against a shadow root fed the
 * identical sequence.
 */
test('children streamed in after the render land as native, chunk by chunk', async () => {
  const stream = async (tag) => {
    const host = D.createElement(tag);
    D.body.append(host);
    if (tag === 't-light') {
      renderInto(html`<div class="box"><slot>FALLBACK</slot></div>`, host);
      await frame();
      await frame();
    }
    for (const make of [
      () => D.createTextNode('first line'),
      () => Object.assign(D.createElement('p'), { textContent: 'para' }),
      () => D.createTextNode(' tail'),
    ]) {
      host.appendChild(make());
      await frame();
      await frame();
    }
    const out = shown(host);
    host.remove();
    return out;
  };
  const want = await stream('t-shadow');
  assert.notEqual(want, 'FALLBACK', 'CONTROL: the oracle received the stream');
  assert.equal(await stream('t-light'), want, 'the streamed children land in order, text included');
});

/**
 * **`slotchange` COUNT parity, not just content parity.**
 *
 * The platform fires on assignment CHANGE, never on every recomputation — a slot that refills with
 * the same nodes stays quiet. Light DOM tracks that with `_shown` and a comparison, which is
 * exactly the kind of invariant that degrades into "fires on every fill" without anyone noticing,
 * because the content stays correct while the event storm doubles work in every consumer.
 *
 * So this counts events through a full lifecycle — re-slot, un-slot, remove each kind, re-add —
 * and compares the NUMBER against a shadow root fed the identical sequence, alongside the content
 * at every step. Note the listener: in light mode the `<slot>` element is deliberately kept out of
 * the document as the component's API object, so `querySelectorAll('slot')` finds nothing and the
 * template binding is how a component listens. A probe that attached listeners the shadow way
 * measured zero events and looked like a total failure.
 */
test('slotchange fires the same number of times as the platform, through a full lifecycle', async () => {
  let lightCount = 0;
  const bump = () => { lightCount++; };
  customElements.define(
    't-life',
    class extends dom.window.HTMLElement {
      connectedCallback() {
        init(this); // LIGHT
        render(() => html`<div class="box"><header><slot name="h" @slotchange=${bump}>HF</slot></header><main><slot @slotchange=${bump}>DF</slot></main></div>`);
      }
    }
  );
  customElements.define(
    't-life-shadow',
    class extends dom.window.HTMLElement {
      constructor() {
        super();
        this.attachShadow({ mode: 'open' }).innerHTML =
          '<div class="box"><header><slot name="h">HF</slot></header><main><slot>DF</slot></main></div>';
      }
    }
  );

  const run = async (tag) => {
    const host = D.createElement(tag);
    const text = D.createTextNode('TEXT');
    const el = Object.assign(D.createElement('p'), { textContent: 'EL' });
    host.append(text, el);
    D.body.append(host);
    let shadowCount = 0;
    lightCount = 0;
    if (host.shadowRoot) for (const s of host.shadowRoot.querySelectorAll('slot')) s.addEventListener('slotchange', () => shadowCount++);
    await frame();
    await frame();
    /** Count from the same point in both: after mount. */
    shadowCount = 0;
    lightCount = 0;
    const read = (name) =>
      host.shadowRoot
        ? [...host.shadowRoot.querySelectorAll('slot')][name === 'h' ? 0 : 1]
            .assignedNodes().map((n) => (n.data ?? n.localName).trim()).filter(Boolean).join(',')
        : slotted(host, name).map((n) => (n.data ?? n.localName).trim()).filter(Boolean).join(',');
    const steps = [];
    const snap = () => steps.push(`h=[${read('h')}] d=[${read('')}]`);
    snap();
    for (const act of [
      () => el.setAttribute('slot', 'h'),
      () => el.removeAttribute('slot'),
      () => text.remove(),
      () => el.remove(),
      () => host.append(D.createTextNode('BACK')),
    ]) {
      act();
      await frame();
      await frame();
      snap();
    }
    host.remove();
    return { steps, count: host.shadowRoot ? shadowCount : lightCount };
  };

  const want = await run('t-life-shadow');
  assert.ok(want.count > 3, `CONTROL: the platform fired only ${want.count} times — the sequence did nothing`);
  const got = await run('t-life');
  assert.deepEqual(got.steps, want.steps, 'assignment matches the platform at every step');
  assert.equal(got.count, want.count, 'and so does the number of slotchange events');
});

/**
 * **A node the user takes for themselves is un-assigned, and the fallback returns.**
 *
 * Moving a slotted node to a live parent elsewhere is not a removal — `parentNode` stays non-null —
 * and the observer read that as an internal move, which is what a keyed row created under the host
 * and positioned inside the component in one batch actually is. So the node stayed captured
 * forever: no longer in the run, so the slot showed NOTHING — not the node, and not its fallback,
 * where a shadow root un-assigns and falls back. `fill` already carried the matching guard ("the
 * user took this node for themselves"); nothing ever gave it a reason to run.
 *
 * The three answers the observer now distinguishes: detached entirely is gone, the holding
 * fragment or anywhere in the host's own subtree is a move, anywhere else is the user's.
 */
test('a slotted node moved to another parent un-assigns, and the fallback comes back', async () => {
  const run = async (tag) => {
    const host = D.createElement(tag);
    const node = D.createElement('b');
    node.setAttribute('slot', 'h');
    node.textContent = 'X';
    host.append(node);
    D.body.append(host);
    if (tag === 't-life') {
      renderInto(html`<div class="box"><header><slot name="h">HF</slot></header><main><slot>DF</slot></main></div>`, host);
      await frame();
      await frame();
    }
    const read = () =>
      host.shadowRoot
        ? host.shadowRoot.querySelector('slot').assignedNodes().map((n) => n.textContent).join(',') || 'HF'
        : host.querySelector('header').textContent;
    const before = read();
    const elsewhere = D.createElement('section');
    D.body.append(elsewhere);
    elsewhere.append(node); // a MOVE, not a removal: parentNode stays non-null
    await frame();
    await frame();
    const after = read();
    host.remove();
    elsewhere.remove();
    return { before, after };
  };
  const want = await run('t-life-shadow');
  assert.equal(want.before, 'X', 'CONTROL: the platform had it assigned to begin with');
  assert.equal(want.after, 'HF', 'CONTROL: and falls back once the user takes it');
  assert.deepEqual(await run('t-life'), want, 'light does the same');
});

/**
 * **`splitText` on distributed content — a node that appears INSIDE a run, never passing the
 * host's top level.**
 *
 * Splitting a text node is what a highlighting library does, and on a light host the text has
 * already been moved into the component, so the tail is created as a sibling THERE. The capture
 * rule looks at the host's top level and never saw it, so it was missing from the bucket — and
 * the next refill of that slot evacuated it to holding and never brought it back. The text
 * silently lost half of itself; a shadow root reports both halves assigned and shows both.
 *
 * Captured from the mutation record rather than by sweeping the run during `fill`: the observer
 * holds the exact node, and re-deriving it downstream would be inference in place of ownership,
 * plus an O(run) scan on every fill of every host. Both guards are facts rather than proxies —
 * the run must be assigned (a run showing fallback holds the component's own nodes), and the
 * node's slot name must match the binding it landed in.
 */
test('splitText on slotted text keeps both halves, as native', async () => {
  const run = async (tag) => {
    const host = D.createElement(tag);
    host.append(D.createTextNode('hello world'));
    D.body.append(host);
    if (tag === 't-light') {
      renderInto(html`<div class="box"><slot>FALLBACK</slot></div>`, host);
      await frame();
      await frame();
    }
    const read = () => (host.shadowRoot ? host.shadowRoot.querySelector('slot').assignedNodes() : slotted(host, ''));
    const tail = read()[0].splitText(5);
    await frame();
    await frame();
    /** Force a refill of the SAME slot — where the uncaptured tail used to be swept away. */
    const nudge = D.createElement('b');
    nudge.setAttribute('slot', '');
    host.append(nudge);
    await frame();
    await frame();
    nudge.remove();
    await frame();
    await frame();
    const now = read();
    const out = {
      assigned: now.length,
      includesTail: now.includes(tail),
      visible: shown(host).replace(/^FALLBACK$/, ''),
    };
    host.remove();
    return out;
  };
  const want = await run('t-shadow');
  assert.equal(want.assigned, 2, 'CONTROL: the platform reports both halves');
  assert.deepEqual(await run('t-light'), want, 'and so do we, through a refill of the same slot');
});
