/**
 * SSR × directives (design §9) — the claim under test is not "the server writes something", it is
 * **the server and the client agree**, so hydration has nothing to reconcile.
 *
 * The suite is therefore DIFFERENTIAL, never recorded: a checked-in snapshot of markup is only as
 * portable as the machine that took it (CLAUDE.md), and worse, it can only prove the server did
 * the same thing twice. So the second half takes the server's own output, boots the real engine on
 * it in jsdom, and asserts the client's first pass changes NOTHING — which is the actual
 * definition of "no hydration mismatch" and the only assertion that can catch a divergence.
 *
 * **Assertions read the PARSED DOM, not the markup text**, and that is a lesson rather than a
 * preference: `data-vd-class="…"` contains the substring `class="`, so a regex looking for a
 * rendered class on an element matches the DIRECTIVE that produced it and passes while proving
 * nothing. Every attribute question here is asked of a parsed element; the raw string is consulted
 * only where the raw string IS the claim (cloak removed, the handler carried verbatim).
 *
 * The import order matters and is the package's own rule: `@verajs/ssr` installs the shim and must
 * precede anything that imports `@verajs/core`.
 */
import { renderToString } from '@verajs/ssr';
import { takeDirectiveNames } from '@verajs/directives';
import assert from 'node:assert/strict';

const { html: markup } = await renderToString(new URL('./fixtures/ssr/directives-ssr.js', import.meta.url));

/**
 * BOTH server renders happen here, before the differential deletes the shim marker — a fixture
 * imported after that point takes the CLIENT path and wires a renderer over the server's, which
 * @verajs/ssr's own guard then refuses. Order is the lesson, and it is the same one the fixtures
 * teach: on a server the renderer is the server's.
 */
const filtered = await renderToString(new URL('./fixtures/ssr/query-ssr.js', import.meta.url), {
  location: '/list?q=err&page=1',
});

assert.ok(markup.includes('<directives-ssr>'), 'the entry tag rendered at all (the dead-page detector)');

/* ── the preload list (the phase-5 handoff) ──────────────────────────────────────────────── */

const names = takeDirectiveNames();
assert.ok(names.includes('lazy-thing'), 'an UNCLAIMED name is reported — those are exactly the ones to preload');
assert.ok(names.includes('show') && names.includes('on-click'), 'and the claimed ones, for a page that self-hosts packs');
assert.deepEqual(takeDirectiveNames(), [], 'draining is a take: a second read is a fresh render');

/* ── raw-text claims, where the text itself is the claim ─────────────────────────────────── */

/**
 * The cloak is gone: it exists to hide markup whose reflections have not run — they have now, so
 * leaving it would hide CORRECT content until the client booted, the very flash it prevents,
 * inverted.
 */
assert.doesNotMatch(markup, /data-vd-cloak/, 'cloak stripped — the server did the job it existed for');
/** The handler travels as markup and needs no hydration: delegation matches it at dispatch. */
assert.ok(markup.includes('data-vd-on-click="{ open: !open }"'), 'the handler is carried verbatim');
/** State stays in the attribute: it IS the source on both sides, so nothing is serialized twice. */
assert.ok(markup.includes("data-vd-state=\"{ open: false"), 'the seed travels as written — one state source');

/* ── the parsed truth: what a browser will actually see before any JS runs ───────────────── */

const { JSDOM } = await import('jsdom');
const dom = new JSDOM(`<!doctype html><body><div id="mount">${markup}</div></body>`, {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const doc = dom.window.document;
/** jsdom does not attach declarative shadow DOM here, so the component's tree is the template's. */
const mount = doc.getElementById('mount');
const region = mount.querySelector('[data-vd-state]')
  ?? mount.querySelector('template')?.content?.querySelector('[data-vd-state]');
assert.ok(region, 'the server markup carried the directive region into the client parse');

const one = (selector) => {
  const el = region.querySelector(selector);
  assert.ok(el, `the fixture rendered a ${selector}`);
  return el;
};

/** `show` is the headline: the closed menu arrives HIDDEN, not visible-then-hidden. */
assert.equal(one('nav').hasAttribute('hidden'), true, 'show wrote hidden for falsy state — no flash of open menu');
assert.equal(one('p').hasAttribute('hidden'), false, 'and left the truthy one alone');

/** Expressions ran server-side — same tier build, so PURE functions and arithmetic both work. */
assert.equal(one('b').textContent, 'VERA', 'text wrote an expression result through upper()');
assert.equal(one('i').textContent, '120', 'and arithmetic');

/** class/style/bind reflections, all derived from the one state object. */
assert.equal(one('span').classList.contains('bulk'), true, 'class toggled on from a comparison');
assert.equal(one('nav').classList.contains('is-open'), false, 'and the falsy one was never added');
assert.equal(one('button').getAttribute('aria-expanded'), 'false', 'aria-* stringifies — the literal word false');
assert.equal(one('button').hasAttribute('disabled'), true, 'bind wrote a boolean attribute present-empty');
assert.equal(one('em').style.opacity, '0.5', 'style wrote a property');

/* ── the differential: the client re-derives the same answer, idempotently ───────────────── */

for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

/**
 * The engine under test is the one the SERVER just used — same module, same registry — so this is
 * genuinely the client pass over the server's markup rather than a second implementation agreeing
 * with itself by construction.
 */
const { activate, settled, rejections } = await import('@verajs/directives');

/**
 * The shim marker has to come off, or `activate` takes the server path again and the comparison
 * proves nothing — the exact shape of a probe that measures nothing and reports perfection.
 *
 * **And the marker is not the only thing the shim leaves behind.** It installs no-op `Observer`
 * constructors so a component that builds an `IntersectionObserver` does not crash server-side, and
 * those survive the render on `globalThis`. A client phase in the same process therefore inherits a
 * DEAD observer: present, so `in-view` takes the observed path, and silent, so nothing is ever
 * reported and the element stays unrevealed for ever. jsdom has none of these natively, so removing
 * them restores the environment a browser actually presents and lets the degradation rule run.
 */
delete globalThis.__veraSsrShimmed;
for (const k of ['IntersectionObserver', 'ResizeObserver', 'PerformanceObserver']) delete globalThis[k];

const before = region.outerHTML;
activate(region);
await settled();

assert.equal(region.outerHTML, before,
  "THE CLAIM: the client's first pass over server markup changes nothing — no hydration mismatch");

const complaints = rejections().filter((r) => r.code !== 'unknown-directive' && r.code !== 'loader-failed');
assert.deepEqual(complaints.map((r) => r.code), [],
  'and it had nothing to complain about beyond the deliberately-unclaimed name');

/** THE CONTROL: a probe that measures nothing reports perfection. Prove the comparison can fail. */
region.querySelector('nav').removeAttribute('hidden');
assert.notEqual(region.outerHTML, before, 'the control: this comparison is sensitive to exactly this');

/** And the client is LIVE on the server's markup — one click, no hydration step anywhere. */
region.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));
await settled();
assert.equal(region.querySelector('nav').hasAttribute('hidden'), false,
  'the server-rendered handler ran on its first click — the page was interactive at boot');

console.log('ssr-directives: server evaluated, client agreed, nothing to reconcile');

/* ── the query pack on the server: a shared link arrives already filtered ─────────────────── */

/**
 * The pack's premise is server-first — *"the server sends the list it was always going to send"* —
 * and until the `ssr` declarations landed it was not true: every item rendered visible and the
 * client hid the rest, which is a flash AND a hydration divergence in the system that claims
 * divergence is structurally impossible. This is that claim, tested.
 */

const visible = [...filtered.html.matchAll(/<li([^>]*)>([a-z]+)<\/li>/g)]
  .filter(([, attrs]) => !/hidden/.test(attrs)).map(([, , text]) => text);
assert.deepEqual(visible, ['cherry', 'elderberry'],
  'the SERVER filtered from the request URL — a shared link reproduces what the sender saw');
assert.match(filtered.html, /<b[^>]*>2<\/b>/, 'and published the count the page renders its results line from');
assert.match(filtered.html, /<i[^>]*>\/list<\/i>/, '@route reached expressions server-side');
assert.match(filtered.html, /<em[^>]*class="[^"]*revealed/,
  'in-view honoured DEGRADED-NEVER-DEAD: a server has no observer, so the content is revealed, ' +
  'not hidden from a reader who will never run JavaScript');

/** And the client agrees — the same differential the reflections get, on the pack that needed it most. */
{
  const dom2 = new JSDOM(`<!doctype html><body><div id="m">${filtered.html}</div></body>`, {
    pretendToBeVisual: true, url: 'http://localhost/list?q=err&page=1',
  });
  for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
    'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
    'MutationObserver', 'CSSStyleSheet', 'location', 'history']) globalThis[k] = dom2.window[k];
  globalThis.requestAnimationFrame = dom2.window.requestAnimationFrame.bind(dom2.window);
  globalThis.cancelAnimationFrame = dom2.window.cancelAnimationFrame.bind(dom2.window);
  delete globalThis.__veraSsrShimmed;
  for (const k of ['IntersectionObserver', 'ResizeObserver', 'PerformanceObserver']) delete globalThis[k];

  const mount2 = dom2.window.document.getElementById('m');
  const region2 = mount2.querySelector('[data-vd-region]')?.closest('[data-vd-state]')
    ?? mount2.querySelector('template')?.content?.querySelector('[data-vd-state]');
  assert.ok(region2, 'the region survived into the client parse');
  const before2 = region2.outerHTML;
  activate(region2);
  await settled();
  assert.equal(region2.outerHTML, before2,
    'THE CLAIM, for the query pack: the client re-derived the same filtered view and changed nothing');
}

console.log('ssr-directives: the query pack agrees too');
