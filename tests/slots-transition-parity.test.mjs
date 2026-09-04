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
