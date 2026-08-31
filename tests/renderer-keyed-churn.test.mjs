/**
 * How much DOM a keyed reconciliation *touches*, counted rather than timed.
 *
 * `renderer-keyed-scale` says so in its own header: it asserts **correctness rather than speed**, and
 * `bench/renderer-vs-lit.mjs` "is a stopwatch, not an oracle". So a change that made a full reverse
 * rebuild every row, or move each one several times, would pass every assertion in the repository and
 * show up only as a list that stutters on someone else's machine.
 *
 * ## Why counting rather than timing
 *
 * A clock is machine-dependent and needs three runs before it is believed — `CLAUDE.md` says so about
 * `bench/reactivity.mjs`. Counting `insertBefore`/`appendChild`/`removeChild`/`replaceChild` is
 * deterministic: the same numbers on any machine, in any order, under any load.
 *
 * ## What this does and does not measure
 *
 * It measures **DOM churn**, not asymptotic time. A reconciliation that scanned quadratically while
 * still moving each row once would pass here. That is a real limit and it is stated rather than
 * papered over — churn is the half that reaches the browser as layout and paint, and it is the half a
 * correctness test cannot see.
 *
 * The promise being pinned is the keyed algorithm's whole reason to exist: **a full reverse moves each
 * row at most once.**
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[key] = dom.window[key];

const { renderInto } = await load('renderer');
const { keyed } = await load('renderer/keyed');
const { html } = await load('core');

const draw = (ids, into) =>
  renderInto(html`<ul>${ids.map((id) => keyed(id, html`<li data-id=${id}>${id}</li>`))}</ul>`, into);

/** Every mutation goes through `Node.prototype`, so wrapping it counts all of them. */
const mutations = (work) => {
  const proto = dom.window.Node.prototype;
  const originals = {};
  const counts = { insertBefore: 0, appendChild: 0, removeChild: 0, replaceChild: 0 };
  for (const name of Object.keys(counts)) {
    originals[name] = proto[name];
    proto[name] = function (...args) {
      counts[name]++;
      return originals[name].apply(this, args);
    };
  }
  try { work(); } finally { for (const name of Object.keys(counts)) proto[name] = originals[name]; }
  return Object.values(counts).reduce((a, b) => a + b, 0);
};

const listOf = (n, prefix) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

test('a full reverse moves each row about once, at every size', () => {
  const report = [];
  for (const n of [100, 200, 400, 800]) {
    const into = dom.window.document.createElement('div');
    const ids = listOf(n, 'k');
    draw(ids, into);

    const moves = mutations(() => draw([...ids].reverse(), into));
    report.push(`${n}: ${moves}`);

    assert.ok(moves <= n * 1.5, `${n} rows reversed in ${moves} mutations — more than one move per row`);
    /** And not vacuously few: a reverse that did nothing would also be "cheap". */
    assert.ok(moves >= n * 0.5, `${n} rows reversed in only ${moves} mutations — the reverse did not happen`);
  }
  assert.equal(report.length, 4);
});

test('and the cost grows with the list, not with its square', () => {
  const cost = (n) => {
    const into = dom.window.document.createElement('div');
    const ids = listOf(n, 'g');
    draw(ids, into);
    return mutations(() => draw([...ids].reverse(), into));
  };

  const small = cost(100);
  const large = cost(800);
  /** Linear is 8x. Quadratic is 64x. Sixteen separates them with room for constants. */
  assert.ok(
    large / small < 16,
    `eight times the rows cost ${(large / small).toFixed(1)}x the mutations (${small} -> ${large}) — that is not linear`
  );
});

/**
 * The control that gives the numbers above their meaning. Replacing every key reuses nothing, so each
 * row is removed and inserted: **twice** the mutations of a reverse. A counter that could not tell
 * those apart would report any reconciliation as fine.
 */
test('replacing every key costs twice as much, which is how we know the count means something', () => {
  const n = 400;
  const into = dom.window.document.createElement('div');
  draw(listOf(n, 'a'), into);

  const reversed = mutations(() => draw(listOf(n, 'a').reverse(), into));
  const replaced = mutations(() => draw(listOf(n, 'b'), into));

  assert.ok(replaced > reversed * 1.5, `a full replacement cost ${replaced} against a reverse's ${reversed}`);
  assert.ok(replaced <= n * 2.5, `a full replacement cost ${replaced} for ${n} rows — more than a remove and an insert each`);
});
