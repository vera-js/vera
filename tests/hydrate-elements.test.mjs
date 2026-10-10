/**
 * **A claim on an element hydration adopted is told so** — `mount(element, { adopted: true })`, with the SERVER's
 * element, so a behavior can skip what the server already did (an animation in, a focus the page already has).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';
import { serve } from './served.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderer, renderInto } = await load('renderer');
const { hydration } = await load('renderer/hydration');
const { elements } = await load('renderer/elements');
const log = [];
/** `create` runs as the instance is set up (the hook's `$c`), `mount` once its render finishes — both are client work. */
const created = [];
const track = { create: (element, adopted) => created.push([element, adopted]), mount: (element, { adopted }) => log.push([element, adopted]) };
core.wire([renderer, hydration, elements, { on: 'element', fn: (el) => (el.hasAttribute('data-track') ? track : undefined), priority: 50 }]);
const { html } = core;
/** The real server's markup for the rows that adopt it (tests/served.mjs). */
const SERVED = serve({
  tracked: "html`<p data-track id=${'s'}>x</p>`",
  bound: "html`<em data-x=${'bound-value'}>x</em>`",
});

test('an adopted element mounts with adopted: true — the server node itself; a client render says false', () => {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = SERVED.tracked;
  const server = host.querySelector('p');
  const draw = (id) => html`<p data-track id=${id}>x</p>`;
  renderInto(draw('s'), host);
  assert.equal(host.querySelector('p'), server, 'CONTROL: adopted');
  assert.deepEqual(log, [[server, true]]);
  const fresh = document.body.appendChild(document.createElement('div'));
  renderInto(draw('f'), fresh);
  assert.deepEqual(log.slice(1).map(([el, adopted]) => [el.id, adopted]), [['f', false]]);
});

/**
 * Claims are asked about a template's CANONICAL content as it is built — so a template whose first instance is one
 * hydration adopted (the server's element, bound values in it) is still asked about static attributes only.
 */
test("a claim is asked about the template, not its first instance — a hydrated one's bound values are invisible", () => {
  const seen = [];
  core.wire({ on: 'element', fn: (el) => { if (el.localName === 'em') seen.push(el.getAttribute('data-x')); }, priority: 60 });
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = SERVED.bound;
  const quiet = console.warn;
  console.warn = () => {};
  try {
    renderInto(html`<em data-x=${'bound-value'}>x</em>`, host);
  } finally {
    console.warn = quiet;
  }
  assert.deepEqual(seen, [null], 'asked once, with no bound value');
});

/**
 * **A claim's `mount` is client work, so it is QUEUED** (vera-5a's bar): a container mismatching at its LAST marker has
 * mounted nothing when it is cleared — the client render then mounts its own element, told `adopted: false`.
 */
test('a mismatching container mounts no claim before it is cleared; the client render mounts once, not adopted', () => {
  const host = document.body.appendChild(document.createElement('div'));
  /** Hand-written on purpose: the mismatch at the last marker is the point. */
  host.innerHTML = '<p data-track id="m">x</p><b>server</b>';
  const draw = () => html`<p data-track id="m">x</p><i>client</i>`;
  const from = log.length;
  const createdFrom = created.length;
  let atClear = null;
  const real = host.removeChild.bind(host);
  host.removeChild = (node) => {
    if (atClear === null) atClear = log.length - from + (created.length - createdFrom);
    return real(node);
  };
  const quiet = console.warn;
  let warned = 0;
  console.warn = () => warned++;
  try {
    renderInto(draw(), host);
  } finally {
    console.warn = quiet;
  }
  assert.equal(warned, 1, 'CONTROL: it fell back');
  assert.equal(atClear, 0, 'a claim was created or mounted before the decision');
  assert.deepEqual(created.slice(createdFrom).map(([el, adopted]) => [el.isConnected, adopted]), [[true, false]], 'CONTROL: create is counted — the client render created once');
  assert.deepEqual(log.slice(from).map(([el, adopted]) => [el.isConnected, adopted]), [[true, false]], 'the client render mounted once');
});

/**
 * **A claim mounts on the SAME element hydrated as rendered fresh.** Claims are found by position in the template; an
 * adopted instance's live tree also holds what its nested parts rendered, so the position must come from the walk's
 * pairing, never a count of the live tree — content before the claim, a fragment root, and a list row each broke it.
 */
test('a hydrated claim mounts on the element a fresh render mounts on: nested content first, a fragment root, a list row', () => {
  const nested = (n) => html`<i id=${`inner-${n}`}>i</i>`;
  const cases = [
    ['nested content before it', (n) => html`<div><b>${nested(n)}</b><p data-track id=${`n-${n}`}>x</p></div>`],
    ['a fragment root', (n) => html`<label>L</label><p data-track id=${`f-${n}`}>x</p>`],
    ['a list row', (n) => html`<ul>${[1, 2].map((r) => html`<li>${nested(`${n}-${r}`)}<p data-track id=${`r-${n}-${r}`}>x</p></li>`)}</ul>`],
  ];
  for (const [name, draw] of cases) {
    /** Fresh, into an empty container: the reference answer. */
    const fresh = document.body.appendChild(document.createElement('div'));
    const from = log.length;
    renderInto(draw('s'), fresh);
    const expected = log.slice(from).map(([el, adopted]) => [el.id, adopted]);
    /** The server's markup is the fresh render's, its anchors stripped — every value here is one a server writes. */
    const host = document.body.appendChild(document.createElement('div'));
    host.innerHTML = fresh.innerHTML.replace(/<!---->/g, '');
    const servers = [...host.querySelectorAll('[data-track]')];
    const at = log.length;
    const quiet = console.warn;
    let warned = 0;
    console.warn = () => warned++;
    try {
      renderInto(draw('s'), host);
    } finally {
      console.warn = quiet;
    }
    assert.equal(warned, 0, `${name}: CONTROL — it hydrated`);
    const got = log.slice(at);
    assert.ok(expected.length > 0, `${name}: CONTROL — the fresh render mounted a claim`);
    assert.deepEqual(got.map(([el]) => el.id), expected.map(([id]) => id), `${name}: mounted on the same elements, by id`);
    assert.ok(got.every(([el, adopted], i) => el === servers[i] && adopted === true), `${name}: the SERVER's elements, told adopted`);
    fresh.remove();
    host.remove();
  }
});
