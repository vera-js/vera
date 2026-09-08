/**
 * **What production says when something is refused.**
 *
 * The prose folds away, and should: it is bytes on every page for text an end user cannot act on.
 * But saying NOTHING is a different mistake, and this package was making it 140 times over — a
 * refusal was recorded in a registry nobody reads and the console stayed empty, so a
 * production-only failure was undebuggable by the one person able to fix it.
 *
 * So production prints the code and where it is explained, once per code, for 56 B gzipped. The
 * DEVELOPMENT half of this file is the one that will rot if unwatched: it asserts that a dev build
 * prints the sentence and NOT the URL, which is the whole reason the fold is worth having — a build
 * that quietly started printing links instead of explanations would pass every other suite here.
 *
 * Both halves run in both builds, each skipping where it does not apply, because `tests/dist.mjs`
 * resolves a different program per run and the claim is about the difference between them.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'MutationObserver',
  'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wireDirectives, expressions, interaction, settled } = await load('directives');
wireDirectives([expressions, ...interaction]);

const lines = [];
const original = console.warn;
console.warn = (...args) => lines.push(args.join(' '));

/**
 * The same refusal from TWO elements, which is what the once-per-code rule is about.
 *
 * `state-not-object` rather than the undeclared-write this first used: that rejection is itself
 * inside `__DEV__`, so production raises it never and the test measured a silence it had caused —
 * the exact shape of a probe that reports perfection because nothing ran.
 */
const host = dom.window.document.createElement('div');
host.innerHTML = `
  <div id="a" data-vd-state="oops"></div>
  <div id="b" data-vd-state="alsoOops"></div>`;
dom.window.document.body.appendChild(host);
await settled();
console.warn = original;

const complaints = lines.filter((line) => line.includes('state-not-object'));

test('production names the code and where it is explained', (t) => {
  if (!isProduction) return t.skip('development prints the sentence instead — asserted below');

  assert.equal(complaints.length, 1, 'once per CODE: two elements making the same mistake is one line');
  assert.match(complaints[0], /^\[vera\] /, 'the prefix every framework diagnostic carries, so one filter finds them all');
  assert.match(complaints[0], /https:\/\/docs\.verajs\.dev\/e\/state-not-object/,
    'the code, and the page that explains it — the only actionable thing left once the prose is gone');
  assert.doesNotMatch(complaints[0], /braced object/,
    'and NOT the sentence: carrying it is what cost 1,469 B across this package');
});

test('development explains it instead, and links nothing', (t) => {
  if (isProduction) return t.skip('production has no prose to print');

  assert.ok(complaints.length > 0, 'the control: the refusal happened at all');
  assert.match(complaints[0], /takes a braced object/, 'the sentence, in full');
  assert.match(complaints[0], /Write data-vd-state=/, 'and the fix beside it');
  assert.doesNotMatch(complaints[0], /docs\.verajs\.dev/,
    'a developer with the explanation in front of them does not need a round trip to read it');
});

test('the URL is declared once, and the docs artifact agrees with the bundle', async () => {
  const { DOCS } = await import('../packages/directives/src/docs-url.ts');
  const { readFileSync } = await import('node:fs');
  const published = JSON.parse(
    readFileSync(new URL('../packages/directives/diagnostics.json', import.meta.url), 'utf8'));

  assert.equal(published.url, DOCS,
    'the pages and the bundles must name the same place — a released bundle is immutable, so a ' +
    'second copy of this string is a link nobody can ever fix');
  assert.match(DOCS, /^https:\/\/[a-z.]+\/e\/$/, 'short and permanent: the path can never be reorganised');

  /** Every code the bundle can print has somewhere to land. */
  assert.ok(published.entries.length > 100, `only ${published.entries.length} codes — the artifact is stale`);
  for (const entry of published.entries) {
    assert.match(entry.code, /^[a-z][a-z0-9-]*$/,
      `${entry.code} is not URL-safe, and it is about to become part of one`);
  }
});
