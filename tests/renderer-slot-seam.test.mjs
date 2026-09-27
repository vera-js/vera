/**
 * The light-slots SEAM in the renderer — the renderer's half of the contract, driven by a FAKE slots
 * module so a regression here is the renderer's and not the real module's. Since 2026-09-24 the
 * slots module owns discovery: it pushes an INSTANCE HOOK onto a template holding `<slot>` through
 * the `'template'` hook (`_$inst$`, a list), and the renderer's whole job is to call each hook for
 * each instance — with the fresh fragment and the render root, before the first update — run the
 * mounts they return AFTER that update (so a bound `name` has committed), keep the cleanups the
 * mounts return, and run them before a branch-away discards the instance's DOM. Every insert is
 * reported to the seam's `$o` with its owner. Slot bindings still consume expression values in order.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, html } = await load('core');
const { renderer, renderInto, hold } = await load('renderer');

/** The fake seam fn: records every consultation, takes over only light roots, parks on teardown. */
const calls = [];
const parked = [];
const inserts = [];
const fakeSeam = (slot, root, name) => {
  calls.push({ name, root, tag: slot.localName });
  /** Decline shadow roots the way the real module will — duck-checked, realm-safe. */
  if (root.host !== undefined && root.nodeType === 11) return null;
  slot.setAttribute('data-taken', name);
  return { name, _$park$: () => parked.push(name) };
};
/** The insert hook: records what the renderer reports. A seam without it reads as an old module. */
fakeSeam.$o = (parent, node, owner) => inserts.push({ parent, node, owner });
/** The instance hook, in the real module's shape: find now, hand over after the first update, park later. */
const instanceHook = {
  $c: (fragment, root) => (root === null ? undefined : [...fragment.querySelectorAll('slot')]),
  $m: (found, root) => {
    const taken = found.map((slot) => fakeSeam(slot, root, slot.getAttribute('name') ?? '')).filter(Boolean);
    return taken.length === 0 ? undefined : taken;
  },
  $q: (taken) => taken.forEach((state) => state._$park$()),
};
const mark = (built, result) => {
  if (/<slot[\s/>]/i.test(result.strings.join(''))) built._$inst$ = instanceHook;
};
wire([
  renderer,
  { name: 'fake-slots', on: 'slot', fn: fakeSeam, priority: 50 },
  { name: 'fake-slots', on: 'template', fn: mark, priority: 60 },
]);

test('the seam is resolved per TEMPLATE and cached — one consultation per shape, per instance', () => {
  /**
   * Replaces a placeholder that asserted `true` and measured nothing (the house rule: a probe that
   * measures nothing reports perfect behaviour). What is actually contracted: the registry is read
   * at template CONSTRUCTION, so a shape records its slots once and every later instance of that
   * same shape reuses the record — consulting the handler once per slot per instance, never
   * re-reading the registry. This is why wiring must precede the first render (documented in the
   * module and at the seam).
   */
  const shape = (n) => html`<div><slot name="per-shape">${n}</slot></div>`;
  const first = dom.window.document.createElement('div');
  renderInto(shape(1), first);
  assert.equal(calls.length, 1, 'first instance of the shape consults once');
  const second = dom.window.document.createElement('div');
  renderInto(shape(2), second);
  assert.equal(calls.length, 2, 'a second INSTANCE consults again (its own cloned slot)');
  assert.deepEqual(calls.map((c) => c.name), ['per-shape', 'per-shape']);
  renderInto(shape(3), second);
  assert.equal(calls.length, 2, 'but a re-render of the same instance does not');
  calls.length = 0;
});

test('slots are discovered — including after the last expression and with no expressions at all', () => {
  const host1 = dom.window.document.createElement('div');
  renderInto(html`<p>${'x'}</p><slot name="tail"></slot>`, host1);
  const host2 = dom.window.document.createElement('div');
  renderInto(html`<slot name="only"></slot>`, host2);
  assert.deepEqual(calls.map((c) => c.name).sort(), ['only', 'tail']);
  assert.equal(calls[0].tag, 'slot', 'the CLONED slot element is handed over');
  assert.equal(calls[0].root, host1, 'the render root is handed over');
  calls.length = 0;
});

test('expression indexing is undisturbed around slots, and re-renders do not re-consult', () => {
  const host = dom.window.document.createElement('div');
  const draw = (a, b) => html`<i>${a}</i><slot name="mid"></slot><b>${b}</b>`;
  renderInto(draw('A', 'B'), host);
  assert.equal(host.querySelector('i').textContent, 'A');
  assert.equal(host.querySelector('b').textContent, 'B');
  assert.equal(calls.length, 1, 'one consultation per slot per instance');
  renderInto(draw('C', 'D'), host);
  assert.equal(host.querySelector('i').textContent, 'C');
  assert.equal(host.querySelector('b').textContent, 'D');
  assert.equal(calls.length, 1, 'a re-render is not a new instance');
  assert.equal(host.querySelector('slot').getAttribute('data-taken'), 'mid', 'the handler acted on the element');
  calls.length = 0;
});

test('a shadow root is consulted and may decline — the native element stays untouched', () => {
  const el = dom.window.document.createElement('div');
  dom.window.document.body.append(el);
  const root = el.attachShadow({ mode: 'open' });
  renderInto(html`<slot name="native"></slot>`, root);
  assert.equal(calls.length, 1, 'the seam consults; policy is the handler’s');
  assert.equal(root.querySelector('slot').hasAttribute('data-taken'), false, 'declined: untouched');
  calls.length = 0;
  el.remove();
});

test('branch-away parks a taken-over slot before its DOM is discarded', () => {
  const host = dom.window.document.createElement('div');
  const inner = () => html`<section><slot name="park-me"></slot></section>`;
  const draw = (on) => html`<div>${hold(on ? inner() : null)}</div>`;
  renderInto(draw(true), host);
  assert.equal(calls.length, 1);
  assert.deepEqual(parked, []);
  renderInto(draw(false), host);
  assert.deepEqual(parked, ['park-me'], 'the seam parked the slot before the branch was torn down');
  calls.length = 0; parked.length = 0;
});

test('slot name defaults to the empty string for an unnamed slot', () => {
  const host = dom.window.document.createElement('div');
  renderInto(html`<article><slot></slot></article>`, host);
  assert.equal(calls[0].name, '');
  calls.length = 0;
});

test('the mount runs AFTER the first update, so a bound slot name has committed', () => {
  /**
   * Mounting before the update read the static markup and got `''` — the slot registered as a
   * second DEFAULT slot and stole the default content. The renderer owns this ordering even though
   * the slots module owns the mount.
   */
  const host = dom.window.document.createElement('div');
  const draw = (name) => html`<div><slot name=${name}></slot></div>`;
  renderInto(draw('bound'), host);
  assert.deepEqual(calls.map((c) => c.name), ['bound'], 'the mount saw the committed name');
  calls.length = 0;
});

test('every insert is reported to the seam, with the root part as `true` and any other part as itself', () => {
  inserts.length = 0;
  const host = dom.window.document.createElement('div');
  const inner = (t) => html`<em>${t}</em>`;
  renderInto(html`<p>${inner('a')}</p>`, host);
  assert.ok(inserts.length >= 2, `the root commit and the nested template were both reported: ${inserts.length}`);
  assert.equal(inserts[inserts.length - 1].owner, true, "the root part's own output is owned by `true`");
  assert.ok(inserts.some((entry) => entry.owner !== true && typeof entry.owner === 'object'), 'a nested part reports itself');
  inserts.length = 0;
});

test('development names a slots module from a different version of the package', { skip: isProduction }, () => {
  /**
   * They are one contract across a bundle boundary, so a CDN page pinning two versions of the package
   * would have its hooks silently stop meeting. `$v` is stamped only by the slots module's
   * development build; a custom strategy carries none and is never checked — the control below.
   */
  const warned = [];
  const warn = console.warn;
  console.warn = (message) => warned.push(String(message));
  try {
    wire({ name: 'fake-slots', on: 'slot', fn: Object.assign(fakeSeam.bind(null), { $o: fakeSeam.$o }), priority: 50 });
    renderInto(html`<p>unversioned</p>`, dom.window.document.createElement('div'));
    assert.deepEqual(warned.filter((w) => w.includes('same version')), [], 'CONTROL: a strategy without $v is not checked');
    wire({ name: 'fake-slots', on: 'slot', fn: Object.assign(fakeSeam.bind(null), { $o: fakeSeam.$o, $v: '0.0.0-elsewhere' }), priority: 50 });
    renderInto(html`<p>versioned</p>`, dom.window.document.createElement('div'));
    assert.ok(warned.some((w) => w.includes('0.0.0-elsewhere') && w.includes('same version')), `named: ${warned.join(' | ')}`);
  } finally {
    console.warn = warn;
  }
});
