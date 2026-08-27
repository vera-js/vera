/**
 * @verajs/renderer/profiler — does it actually detect what it exists to detect?
 *
 * The profiler's whole purpose is distinguishing a template committed in place from a template
 * that replaced a different one, because the second destroys and rebuilds the subtree while
 * looking identical from the outside. These tests assert that distinction directly, against the
 * BUILT development artifact.
 */
import { load, isProduction } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
/**
 * Deliberately NOT `globalThis.performance = dom.window.performance`: jsdom's Performance
 * delegates to the global of the same name, so assigning it back makes `now()` call itself until
 * the stack runs out. Node's own `performance` is already global and is what the profiler uses.
 */

/**
 * `@verajs/renderer/profiler` is deliberately not built for production — its instrumentation sits
 * behind `__DEV__`, which the production build folds to `false`, so a production profiler would
 * measure code that is no longer there. The production pass therefore has nothing to exercise
 * here, and skips rather than failing to resolve a bundle that is not meant to exist.
 */
const skip = isProduction;
const { renderInto, startProfiling, stopProfiling, isProfiling, profile, formatReport } = skip
  ? {}
  : await load('renderer/profiler');

const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

let el;
beforeEach(() => {
  el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
});

test('a stable template shape reports updates and no rebuilds', { skip }, () => {
  const view = (n) => html`<p>count: ${n}</p>`;
  const { report } = profile(() => {
    for (let i = 0; i < 5; i++) renderInto(view(i), el);
  });
  assert.equal(report.creates, 1, 'first render creates');
  assert.equal(report.updates, 4, 'the rest update in place');
  assert.equal(report.rebuilds, 0, 'nothing is torn down');
  assert.equal(report.churn.length, 0);
  assert.equal(report.frames, 5);
});

test('swapping subtrees is reported as churn, with both shapes and a location', { skip }, () => {
  const swap = (on) => (on ? html`<a href="/x">on</a>` : html`<b>off</b>`);
  const { report } = profile(() => {
    for (let i = 0; i < 6; i++) renderInto(swap(i % 2 === 0), el);
  });
  assert.equal(report.rebuilds, 5, 'every toggle after the first tears down');
  assert.equal(report.updates, 0, 'no commit was ever in place');
  assert.equal(report.churn.length, 2, 'two directions of the same swap');

  const total = report.churn.reduce((sum, c) => sum + c.count, 0);
  assert.equal(total, 5);
  const [worst] = report.churn;
  assert.match(worst.where, /div#app/, 'names where it happened');
  assert.ok(worst.from.length > 0 && worst.to.length > 0, 'names both templates');
  assert.notEqual(worst.from, worst.to);
});

test('the documented fix actually removes the churn it reports', { skip }, () => {
  /** The same UI as the swap test, written as one stable shape per the house guidance. */
  const stable = (on) => html`<span ?hidden=${!on}>on</span><span ?hidden=${on}>off</span>`;
  const { report } = profile(() => {
    for (let i = 0; i < 6; i++) renderInto(stable(i % 2 === 0), el);
  });
  assert.equal(report.rebuilds, 0, 'stable shape never tears down');
  assert.equal(report.updates, 5);
  assert.equal(report.churn.length, 0);
});

test('a render nested inside another folds into one frame', { skip }, () => {
  const inner = document.createElement('div');
  document.body.appendChild(inner);
  /**
   * The nesting has to be real. Calling `renderInto()` while building the outer template's values
   * would merely sequence the two - the arguments are evaluated before `renderInto()` is entered. A
   * callback ref fires during commit, which is genuinely inside the outer frame.
   */
  const { report } = profile(() => {
    renderInto(html`<p ${() => renderInto(html`<i>x</i>`, inner)}>outer</p>`, el);
  });
  assert.equal(inner.textContent, 'x', 'the nested render really happened');
  assert.equal(el.textContent, 'outer');
  assert.equal(report.frames, 1, 'the inner render does not count as its own frame');
});

test('profiling is off by default and reports nothing after stopping', { skip }, () => {
  assert.equal(isProfiling(), false);
  renderInto(html`<p>${1}</p>`, el);
  startProfiling();
  assert.equal(isProfiling(), true);
  const report = stopProfiling();
  assert.equal(isProfiling(), false);
  assert.equal(report.updates + report.creates + report.rebuilds, 0);

  /** Renders after stopping must not accumulate into the next session. */
  renderInto(html`<p>${2}</p>`, el);
  startProfiling();
  const second = stopProfiling();
  assert.equal(second.frames, 0);
});

test('the report reads as guidance, not just numbers', { skip }, () => {
  const swap = (on) => (on ? html`<a>on</a>` : html`<b>off</b>`);
  const { report } = profile(() => {
    renderInto(swap(true), el);
    renderInto(swap(false), el);
  });
  const text = formatReport(report);
  assert.match(text, /rebuilt/);
  assert.match(text, /identity churn/);
  assert.match(text, /\?hidden=/, 'points at the fix');
});

test('a thrown render still stops profiling', { skip }, () => {
  assert.throws(() => {
    profile(() => {
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(isProfiling(), false, 'not left armed after a throw');
});

// ── overlay ─────────────────────────────────────────────────────────────────

test('the overlay mounts, reports churn, and unmounts cleanly', { skip }, async () => {
  const { showProfiler } = await load('renderer/profiler');
  const before = document.body.childElementCount;
  const close = showProfiler({ interval: 5 });

  assert.equal(isProfiling(), true, 'showing the panel starts profiling');
  const host = document.body.lastElementChild;
  assert.ok(host.shadowRoot, 'mounted into a shadow root');

  const swap = (on) => (on ? html`<a>on</a>` : html`<b>off</b>`);
  for (let i = 0; i < 4; i++) renderInto(swap(i % 2 === 0), el);

  await new Promise((r) => setTimeout(r, 30));
  const text = host.shadowRoot.textContent;
  assert.match(text, /Torn down, not updated/, 'surfaces churn');
  assert.match(text, /rebuilt/);
  assert.match(text, /\?hidden=/, 'shows the fix');

  close();
  assert.equal(document.body.childElementCount, before, 'panel removed');
  assert.equal(isProfiling(), false, 'closing stops profiling');
});

test('the overlay does not measure itself', { skip }, async () => {
  const { showProfiler, getReport } = await load('renderer/profiler');
  const close = showProfiler({ interval: 5 });
  /** Let it repaint several times with no app renders at all. */
  await new Promise((r) => setTimeout(r, 40));
  const report = getReport();
  close();
  assert.equal(report.frames, 0, 'repainting the panel is not a render frame');
  assert.equal(report.updates + report.creates + report.rebuilds, 0, 'and commits nothing');
});
