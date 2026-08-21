/**
 * @verajs/renderer/profiler — does it actually detect what it exists to detect?
 *
 * The profiler's whole purpose is distinguishing a template committed in place from a template
 * that replaced a different one, because the second destroys and rebuilds the subtree while
 * looking identical from the outside. These tests assert that distinction directly, against the
 * BUILT development artifact.
 */
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

const { render, startProfiling, stopProfiling, isProfiling, profile, formatReport } = await import(
  '../packages/renderer/dist/development/vera-renderer-profiler.js'
);

const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

let el;
beforeEach(() => {
  el = document.createElement('div');
  el.id = 'app';
  document.body.appendChild(el);
});

test('a stable template shape reports updates and no rebuilds', () => {
  const view = (n) => html`<p>count: ${n}</p>`;
  const { report } = profile(() => {
    for (let i = 0; i < 5; i++) render(view(i), el);
  });
  assert.equal(report.creates, 1, 'first render creates');
  assert.equal(report.updates, 4, 'the rest update in place');
  assert.equal(report.rebuilds, 0, 'nothing is torn down');
  assert.equal(report.churn.length, 0);
  assert.equal(report.frames, 5);
});

test('swapping subtrees is reported as churn, with both shapes and a location', () => {
  const swap = (on) => (on ? html`<a href="/x">on</a>` : html`<b>off</b>`);
  const { report } = profile(() => {
    for (let i = 0; i < 6; i++) render(swap(i % 2 === 0), el);
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

test('the documented fix actually removes the churn it reports', () => {
  /** The same UI as the swap test, written as one stable shape per the house guidance. */
  const stable = (on) => html`<span ?hidden=${!on}>on</span><span ?hidden=${on}>off</span>`;
  const { report } = profile(() => {
    for (let i = 0; i < 6; i++) render(stable(i % 2 === 0), el);
  });
  assert.equal(report.rebuilds, 0, 'stable shape never tears down');
  assert.equal(report.updates, 5);
  assert.equal(report.churn.length, 0);
});

test('a render nested inside another folds into one frame', () => {
  const inner = document.createElement('div');
  document.body.appendChild(inner);
  /**
   * The nesting has to be real. Calling `render()` while building the outer template's values
   * would merely sequence the two - the arguments are evaluated before `render()` is entered. A
   * callback ref fires during commit, which is genuinely inside the outer frame.
   */
  const { report } = profile(() => {
    render(html`<p ${() => render(html`<i>x</i>`, inner)}>outer</p>`, el);
  });
  assert.equal(inner.textContent, 'x', 'the nested render really happened');
  assert.equal(el.textContent, 'outer');
  assert.equal(report.frames, 1, 'the inner render does not count as its own frame');
});

test('profiling is off by default and reports nothing after stopping', () => {
  assert.equal(isProfiling(), false);
  render(html`<p>${1}</p>`, el);
  startProfiling();
  assert.equal(isProfiling(), true);
  const report = stopProfiling();
  assert.equal(isProfiling(), false);
  assert.equal(report.updates + report.creates + report.rebuilds, 0);

  /** Renders after stopping must not accumulate into the next session. */
  render(html`<p>${2}</p>`, el);
  startProfiling();
  const second = stopProfiling();
  assert.equal(second.frames, 0);
});

test('the report reads as guidance, not just numbers', () => {
  const swap = (on) => (on ? html`<a>on</a>` : html`<b>off</b>`);
  const { report } = profile(() => {
    render(swap(true), el);
    render(swap(false), el);
  });
  const text = formatReport(report);
  assert.match(text, /rebuilt/);
  assert.match(text, /identity churn/);
  assert.match(text, /\?hidden=/, 'points at the fix');
});

test('a thrown render still stops profiling', () => {
  assert.throws(() => {
    profile(() => {
      throw new Error('boom');
    });
  }, /boom/);
  assert.equal(isProfiling(), false, 'not left armed after a throw');
});
