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
const { slots } = await load('renderer/slots');
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
 * **THE KNOWN DIVERGENCE, pinned deliberately: membership is native, ORDER is not.**
 *
 * A node inserted into the light region after the first render is captured with native semantics —
 * no `slot` attribute needed, text included (that is what the sentinel bought). Where it lands in
 * its slot's content is where this parts company with the platform: native keeps the light tree
 * intact and reads assignment order from it, while distribution here MOVES nodes into the
 * component, so by the time a late insertion arrives, the siblings that would have ordered it are
 * no longer beside it. Document position cannot stand in: an undistributed node sits in the host
 * ahead of ALL distributed content, which is right for a user's `insertBefore` and wrong for a
 * list's freshly created row, and nothing in the DOM tells those two apart.
 *
 * Measured against a native shadow root given the identical mutation: the platform answers
 * `PREPENDED, Body`; this answers `Body, PREPENDED`. Closing it needs a position record per
 * captured node — the tombstone tier of `MARKERLESS-RENDERER.md`, shelved on complexity grounds.
 *
 * Pinned rather than left loose so the behaviour is a decision with a reason attached, and so a
 * future positional model announces itself here by failing.
 */
test('KNOWN DIVERGENCE: a late light-region insertion joins its slot at the end, not in document order', async () => {
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
  assert.equal(shown(host), 'BodyPREPENDED',
    'captured (native membership) but appended — native would answer PREPENDEDBody; see the note above');
  page.remove();
});
