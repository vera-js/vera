/**
 * THE KEYFRAME LIST'S TWO EDGES — what the compiler emits at `0%`/`100%`, and what it does past
 * the stop cap. Both are API (`packages/directives/README.md`, `llms.txt`); neither had a test
 * before 2026-09-14, and both changed behaviour that week without a suite noticing.
 *
 * **Missing ends are the PLATFORM'S to fill.** A list with no `0%` frame has that frame constructed
 * from the element's own computed value, per CSS Animations — and the lone-value shorthand is built
 * on it: `opacity: '0.2'` is one frame at 100%, animated to from wherever the element is. A padding
 * step that synthesised the missing ends shipped briefly and turned exactly that into a constant
 * (`0% 0.2, 100% 0.2`). What the ELEMENT then does with these frames is a browser question and is
 * asked in `tests/browser/motion-leading-gap.test.js`; this file pins the EMISSION, which is where
 * the regression actually lived.
 *
 * **Past the cap the list is refused whole, never truncated.** Animating the first 256 of 257 stops
 * means the author's final value never arrives and the element rests somewhere they never wrote —
 * a different animation, chosen by the engine, that looks plausible.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { pretendToBeVisual: true, url: 'https://x.test/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet',
  'location', 'history', 'getComputedStyle']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { renderMotion } = await load('directives/motion');

/** Render one attribute value inline and hand back the emitted CSS plus the server's refusals. */
const emit = (value) => {
  const page = new JSDOM(`<body><div id="a" data-vd-motion="${value}">x</div></body>`,
    { url: 'https://x.test/' });
  const doc = page.window.document;
  const report = renderMotion(doc, { inline: true, diagnostics: false });
  const style = [...doc.getElementById('a').children].find((c) => c.localName === 'style');
  return { css: style?.textContent ?? '', report };
};

/**
 * The percentage stops inside the `@keyframes` block, in source order. Depth-counted rather than
 * matched with a regex: the emitter writes the whole block on one line and each stop carries its own
 * braces, so a lazy `\{([\s\S]*?)\}` stops at the FIRST stop's closing brace and reports one frame
 * for every list. That read `[]` for a 256-stop list and looked exactly like a refusal.
 */
const stops = (css) => {
  const open = /@keyframes\s+\S+\s*\{/.exec(css);
  if (!open) return [];
  let depth = 1;
  let i = open.index + open[0].length;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') depth--;
  }
  const body = css.slice(open.index + open[0].length, i - 1);
  return [...body.matchAll(/(-?[\d.]+)%\s*\{/g)].map((m) => Number(m[1]));
};

test('a lone value emits ONE frame at 100% — the 0% is the element’s, and CSS supplies it', () => {
  const { css, report } = emit("{ keyframes: { opacity: '0.2' }, scroll: '100%, 0%' }");
  assert.equal(report.rendered, 1, 'the CONTROL: the element rendered at all');
  assert.deepEqual(stops(css), [100],
    'exactly one stop — a synthesized 0% here is the constant-animation regression');
  assert.match(css, /opacity\(0\.2\)/, 'and it carries the authored value');
});

test('THE CONTROL: a two-value bare list still spreads to both ends', () => {
  /** Without this, the assertion above would also pass on a compiler that emitted nothing useful:
   *  it proves the emitter DOES write a 0% when the grammar calls for one. */
  const { css } = emit("{ keyframes: { opacity: '0, 1' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(css), [0, 100], 'the sequence rule puts frames at both ends');
});

test('a list starting past 0% keeps its authored stops and synthesises neither end', () => {
  const { css } = emit("{ keyframes: { opacity: '50% 0, 80% 1' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(css), [50, 80],
    'no 0% and no 100% — an author wanting the hold writes `0% 0, 50% 0, 80% 1`');
});

test('the author CAN hold the value, by writing the stop the grammar already provides', () => {
  /** The documented escape hatch. If this ever stops working, the revert above left authors with
   *  no way to express the held start at all, which is the only thing the padding was good for. */
  const { css } = emit("{ keyframes: { opacity: '0% 0, 50% 0, 80% 1' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(css), [0, 50, 80], 'the explicit 0% is honoured');
});

test('KNOWN ISSUE, pinned so the fix cannot land quietly: a group invents the missing ends', () => {
  /**
   * Properties sharing an easing compile into ONE `@keyframes` rule whose stops are the union of
   * theirs, and the sampler CLAMPS a member outside its authored span (`generate.ts:60,62` reached
   * from `:540`) instead of leaving it out for the platform to fill. So the rule above holds for a
   * property animated alone and breaks when it shares a group with one that reaches the ends — a
   * fade beside a scale, which is as common as this grammar gets.
   *
   * Pre-existing (HEAD behaves identically; the padding that briefly made it universal was reverted
   * on 2026-09-14). The repair is NOT simply omitting the declaration: `scale` and `translate-y`
   * both compile to `transform`, and a partial `transform` drops the omitted piece to its default
   * rather than to the element's value — so it needs a ruling, and is open in the plan.
   *
   * **This test asserts the WRONG behaviour on purpose.** When the fix lands it fails, which is the
   * point: the documented exception in `packages/directives/README.md` and `llms.txt` has to be
   * removed in the same pass, and nothing else would force that.
   */
  const { css } = emit("{ keyframes: { opacity: '0.2', scale: '0, 1' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(css), [0, 100], 'the union of both properties’ stops');
  const zero = /0%\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
  assert.match(zero, /opacity\(0\.2\)/,
    'TODAY: opacity is pinned at its authored value from 0%, so it never animates');

  /** The CONTROL that keeps this honest: alone, the same value is correct. If this ever fails the
   *  two cases have converged and the assertion above is no longer describing a divergence. */
  const solo = emit("{ keyframes: { opacity: '0.2' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(solo.css), [100], 'alone it still emits one frame and animates');
});

test('two lone values together are NOT affected — neither reaches an end', () => {
  /** Narrows the issue above to its real trigger. The problem is not grouping; it is grouping with
   *  a property that reaches an end, and a doc saying otherwise would over-warn. */
  const { css } = emit("{ keyframes: { opacity: '0.2', scale: '0.5' }, scroll: '100%, 0%' }");
  assert.deepEqual(stops(css), [100], 'the union is just 100%, so nothing is invented');
});

const list = (n) => Array.from({ length: n }, (_, i) => `${((i * 100) / (n - 1)).toFixed(3)}% ${i % 2}`).join(', ');

test('256 stops animate — the CONTROL that makes the rejection below mean something', () => {
  const { css, report } = emit(`{ keyframes: { opacity: '${list(256)}' }, scroll: '100%, 0%' }`);
  assert.equal(report.rendered, 1, 'a list exactly at the cap is fine');
  assert.equal(stops(css).length, 256, 'and every authored stop is emitted');
});

test('257 stops refuse the WHOLE list rather than animating the first 256', () => {
  const { css, report } = emit(`{ keyframes: { opacity: '${list(257)}' }, scroll: '100%, 0%' }`);
  assert.equal(stops(css).length, 0, 'nothing is emitted — a truncated list is a different animation');
  const problems = JSON.stringify(report.problems ?? []);
  assert.match(problems, /motion-too-many-keyframes/,
    'and the refusal names the cap, so the author is not left guessing why nothing moved');
});
