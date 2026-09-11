/**
 * The `'loader'` seam (design §7): an unknown `data-vd-*` name is a QUESTION before it is a
 * refusal. The engine asks the page's loader chain through the substrate stamp; a claimed
 * module registers itself via `wireDirectives` (module caching = same registry); queued
 * elements activate when the claim settles, and only FINAL outcomes reach the append-only
 * rejections registry.
 *
 * The real `directiveLoader` runs here against file:// fixtures — a genuine dynamic import in
 * this very process, with the fixture importing `@verajs/directives` bare (workspace
 * resolution under --conditions development), which is precisely the module-caching contract
 * the design leans on.
 *
 * DEV-ONLY SUITE: the fixtures' bare import resolves to the development bundle, while a
 * production run of this file holds the production engine — two registries by construction,
 * which is not the seam under test (the CDN story is the import map making both sides one URL).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wire } = await load('core');
const { directiveLoader } = await load('autoloader');

/**
 * A HAND-WRITTEN chain member ahead of the real one, so decline/claim ordering is observable:
 * it declines everything except 'claimed-but-empty', which it claims with a promise that
 * registers nothing — the loader-loaded-nothing path without touching the filesystem.
 */
const asked = [];
const handLoader = {
  on: 'loader',
  priority: 10,
  fn: (name) => {
    asked.push(name);
    if (name === 'claimed-but-empty') return Promise.resolve();
    return false;
  },
};

const fixtures = directiveLoader(import.meta.url, 'fixtures/directive-modules');
wire([handLoader, fixtures]);

const { wireDirectives, interactions, settled, rejections } = await load('directives');
wireDirectives(interactions);

const doc = dom.window.document;
const tick = () => new Promise((r) => setTimeout(r, 30));
const mount = async (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  await settled();
  return host;
};

test('a lazily-loaded directive: unknown at activation, fetched by convention, active after', { skip: isProduction }, async () => {
  const host = await mount(`
    <p id="a" data-vd-glow="gold">a</p>
    <p id="b" data-vd-glow>b</p>`);
  /** Both elements queued behind ONE import — the per-name memo. */
  await tick();
  await settled();
  assert.equal(host.querySelector('#a').getAttribute('data-glowing'), 'gold', 'the module registered and the queued element activated');
  assert.equal(host.querySelector('#b').getAttribute('data-glowing'), 'on', 'both askers were served');
  assert.equal(rejections(host.querySelector('#a')).length, 0, 'a fulfilled question is not a refusal');
  host.remove();
  await settled();
  assert.equal(doc.getElementById('a'), null);
});

test('the chain is ordered: the hand loader is asked first and its decline falls through', { skip: isProduction }, async () => {
  assert.ok(asked.includes('glow'), 'the earlier chain member saw the name before the convention loader');
});

test('a claim that loads nothing earns loader-loaded-nothing, once, memoized', { skip: isProduction }, async () => {
  const host = await mount(`<p data-vd-claimed-but-empty>x</p>`);
  await tick();
  const el = host.querySelector('p');
  assert.ok(rejections(el).some((r) => r.code === 'loader-loaded-nothing'), 'the honest code');
  /** A second element with the same name is refused from the memo — no second ask. */
  const before = asked.filter((n) => n === 'claimed-but-empty').length;
  const more = await mount(`<p data-vd-claimed-but-empty>y</p>`);
  await tick();
  assert.equal(asked.filter((n) => n === 'claimed-but-empty').length, before, 'memoized: asked once per page');
  assert.ok(rejections(more.querySelector('p')).some((r) => r.code === 'unknown-directive'), 'later askers get the settled refusal');
  host.remove(); more.remove();
  await settled();
});

test('a name every loader declines is unknown-directive, with the loader-aware fix text', { skip: isProduction }, async () => {
  /** A leading digit is outside the name grammar, so the convention loader declines too —
   *  with it wired, a well-formed unknown name is a FETCH ATTEMPT (loader-failed), never a
   *  plain unknown; total decline needs a name no loader will touch. */
  const host = await mount(`<p data-vd-9nope>x</p>`);
  await tick();
  const reasons = rejections(host.querySelector('p'));
  assert.ok(reasons.some((r) => r.code === 'unknown-directive'));
  assert.ok(reasons.some((r) => /declined/.test(r.fix ?? '')), 'the fix names the decline, not a missing wire');
  host.remove();
  await settled();
});

test('a failed import earns loader-failed and is memoized like any refusal', { skip: isProduction }, async () => {
  const host = await mount(`<p data-vd-missing-module>x</p>`);
  await tick();
  const reasons = rejections(host.querySelector('p'));
  assert.ok(reasons.some((r) => r.code === 'loader-failed'), 'the 404-shaped outcome has its own code');
  host.remove();
  await settled();
});

test('markup cannot aim the loader: a name outside the grammar never becomes a URL', { skip: isProduction }, async () => {
  /** The attribute tail is attacker-writable on CMS pages — the allowlist is the whole defense. */
  assert.equal(fixtures('..%2f..%2fevil', doc.body), false, 'declined before any URL existed');
  assert.equal(fixtures('UPPER', doc.body), false);
  assert.equal(fixtures('.hidden', doc.body), false);
  assert.throws(() => fixtures.url('..%2f..%2fevil'), /not a directive name/);
});

test('url() is the preload surface, and containment refuses an escaping alias', { skip: isProduction }, () => {
  assert.match(fixtures.url('glow'), /fixtures\/directive-modules\/glow\.js$/);
  const escaping = directiveLoader(import.meta.url, '.', { alias: { sneaky: '../../outside.js' } });
  assert.throws(() => escaping.url('sneaky'), /resolves outside/);
  assert.equal(escaping('sneaky', doc.body), false, 'load declines where url() throws');
});
