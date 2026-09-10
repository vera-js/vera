/**
 * SSR emission — stage 7's server half, under jsdom.
 *
 * `renderMotion(document, { wire })` runs the same parser and generator the client runs and emits
 * what the client would have delivered: markers on in-scope elements, one `data-vera-sheet` style
 * per tree, `@property` declarations document-level, the `(scripting: none)` neutraliser LAST.
 * The claims here are about the EMITTED TEXT and the marks — value-level "frame 0 actually
 * paints" claims are browser-truth and live in the hydration suite.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><head></head><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'CSSStyleSheet', 'MutationObserver', 'getComputedStyle',
  'IntersectionObserver', 'ResizeObserver']) {
  if (dom.window[k]) globalThis[k] = dom.window[k];
}
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { renderMotion, presets } = await load('directives/motion');
const doc = dom.window.document;

const reset = () => {
  doc.body.innerHTML = '';
  for (const style of [...doc.head.children]) style.remove();
};

test('an in-scope element is marked, and its sheet carries the whole delivery in client order', () => {
  reset();
  doc.body.innerHTML = `
    <div id="a" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1', translate-y: '0% 40px, 100% 0px' } }">x</div>`;
  const report = renderMotion(doc);

  assert.equal(report.rendered, 1);
  const el = doc.querySelector('#a');
  assert.match(el.getAttribute('data-vd-a') ?? '', /^[0-9a-f]{8}$/, 'marked with the content hash');

  const style = doc.head.querySelector('style[data-vera-sheet]');
  assert.ok(style, 'one owned style in head');
  const css = style.textContent;
  assert.match(css, /@property --vd-p \{ syntax: '<number>'; inherits: false; initial-value: 0; \}/,
    'the variable is typed and defaults to 0 — frame 0 with no JS');
  assert.match(css, /@keyframes vd-[0-9a-f]{8}/, 'the generated rule');
  assert.match(css, new RegExp(`\\[data-vd-a="${el.getAttribute('data-vd-a')}"\\]`), 'the element rule');
  assert.ok(css.trimEnd().endsWith('@media (scripting: none) { [data-vd-a][data-vd-a] { animation: none; } }'),
    'the neutraliser is LAST — its position is its function');
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \[data-vd-a\]\[data-vd-a\]/,
    'reduced motion neutralises with it — the designed page, journey skipped');
  /** DOUBLED, structurally pinned: a single-attribute tail loses 0-1-0 vs 0-2-0 to every
   *  element rule regardless of order — and no harness can disable scripting to catch it, so
   *  the selector arithmetic is the only possible witness. */
  assert.ok(!/\{ \[data-vd-a\] \{/.test(css), 'no single-attribute neutraliser survives');
  assert.ok(css.indexOf('@property') < css.indexOf('@keyframes'), 'declarations before rules');
});

test('two identical elements share every rule; a tuned third adds its own', () => {
  reset();
  doc.body.innerHTML = `
    <div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>
    <div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>
    <div data-vd-motion="{ keyframes: { opacity: '0% 0.5, 100% 1' } }">x</div>`;
  const report = renderMotion(doc);
  assert.equal(report.rendered, 3);
  const css = doc.head.querySelector('style[data-vera-sheet]').textContent;
  const keyframes = css.match(/@keyframes vd-[0-9a-f]{8}/g) ?? [];
  assert.equal(keyframes.length, 2, 'two distinct animations, three elements — content-hash dedupe');
  const [first, second] = [...doc.querySelectorAll('[data-vd-a]')];
  assert.equal(first.getAttribute('data-vd-a'), second.getAttribute('data-vd-a'), 'twins share identity');
});

test('a preset resolves through the SAME wire array the page uses', () => {
  reset();
  doc.body.innerHTML = `<div data-vd-motion="fade-up">x</div>`;
  const report = renderMotion(doc, { wire: [presets] });
  assert.equal(report.rendered, 1, 'the preset expanded server-side');
  assert.match(doc.querySelector('div').getAttribute('data-vd-a') ?? '', /^[0-9a-f]{8}$/);
});

test('stagger renders SERVER-SIDE since 8a — % offsets go out inline; tick-only still waits for JS', () => {
  reset();
  doc.body.innerHTML = `
    <div data-vd-motion="{ stagger: '10%' }">
      <div id="m0" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>
      <div id="m1" data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>
    </div>
    <div data-vd-motion="{ tick: 'drawFrame', scroll: '100%, 0%' }">x</div>`;
  const report = renderMotion(doc);
  assert.equal(report.rendered, 2, 'both members paint frame 0 now');
  /** Two skips: the stagger HOST (a real shape, animates nothing itself) and the tick element. */
  assert.equal(report.skipped, 2, 'the host and the tick element are honestly JS/none-first');
  const m0 = doc.querySelector('#m0');
  const m1 = doc.querySelector('#m1');
  assert.equal(m0.getAttribute('data-vd-a'), m1.getAttribute('data-vd-a'),
    'siblings share one identity — the offset is a var, not a rule fork');
  assert.equal(m0.style.getPropertyValue('--vd-so'), '', 'index 0 carries no offset');
  assert.equal(m1.style.getPropertyValue('--vd-so'), '0.1', 'index 1 is one step in, inline from the server');
  const css = doc.head.querySelector('style[data-vera-sheet]').textContent;
  assert.match(css, /- var\(--vd-so, 0\)/, 'the seek subtracts the offset for everyone, fallback 0');
});

test('a shadow tree gets its OWN sheet — keyframes are tree-scoped — and @property stays in head', () => {
  reset();
  const host = doc.createElement('div');
  doc.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>`;
  const report = renderMotion(doc);

  assert.equal(report.rendered, 1);
  const inner = root.querySelector('style[data-vera-sheet]');
  assert.ok(inner, 'the sheet lives INSIDE the tree that uses it');
  assert.match(inner.textContent, /@keyframes vd-/);
  assert.ok(inner.textContent.trimEnd().endsWith('@media (scripting: none) { [data-vd-a][data-vd-a] { animation: none; } }'),
    'each tree carries its own neutralisers — document rules do not cross the boundary');
  assert.ok(!inner.textContent.includes('@property'), 'registration is document-global, not repeated');
  const head = doc.head.querySelector('style[data-vera-sheet]');
  assert.ok(head && head.textContent.includes('@property --vd-p'), 'the declaration has a home in head');
});

test('re-rendering the same document converges instead of accumulating', () => {
  reset();
  doc.body.innerHTML = `<div data-vd-motion="{ keyframes: { opacity: '0% 0, 100% 1' } }">x</div>`;
  renderMotion(doc);
  const once = doc.head.querySelector('style[data-vera-sheet]').textContent;
  renderMotion(doc);
  assert.equal(doc.head.querySelectorAll('style[data-vera-sheet]').length, 1, 'one owned style, reused');
  assert.equal(doc.head.querySelector('style[data-vera-sheet]').textContent, once, 'byte-identical');
});

test('a width band emits its segments and switches, switches after the element rule', () => {
  reset();
  doc.body.innerHTML =
    `<div data-vd-motion="{ keyframes: { opacity: '0% 0.6, 100% 0.6; [0-560]: 0% 0.1, 100% 0.1' } }">x</div>`;
  const report = renderMotion(doc);
  assert.equal(report.rendered, 1);
  const css = doc.head.querySelector('style[data-vera-sheet]').textContent;
  assert.match(css, /@media \(max-width: 560px\)/, 'the band is an @media switch');
  const marker = doc.querySelector('[data-vd-a]').getAttribute('data-vd-a');
  assert.ok(css.indexOf(`[data-vd-a="${marker}"][data-vd-a] { animation:`) <
    css.indexOf('@media (max-width: 560px)'),
  'cascade order: the switch enters AFTER the element rule or it loses everywhere');
});
