/**
 * Hydration against markup it did not expect.
 *
 * The invariant is not "does it adopt" — `hydrate-parity` and `hydrate-mismatch` cover that. It is:
 *
 *   **For any markup, hydrating either adopts or falls back. It never throws.**
 *
 * That matters because the markup on the page is not always the markup this client would render. A
 * proxy injects a banner, a CDN re-encodes entities, one region is still served by an older build, a
 * browser extension edits the DOM before the bundle runs. Falling back is correct and costs a first
 * paint; an exception out of `renderInto` costs the page.
 *
 * `hydrate.ts` signals a disagreement by throwing a private `MISMATCH` sentinel that `tryAdopt`
 * catches — so "never throws" is a claim about **which** exception escapes, and there is exactly one
 * line deciding it. `cursorSplit` is the other reason to ask: it casts `cursor.node` to `Text`
 * whenever `offset > 0`, and a cast is an assertion rather than a check.
 *
 * ## Shape of the generation
 *
 * Markup is **mutated from what the server would have produced**, not invented, so the cases sit in
 * the near-miss neighbourhood where a walk is most likely to go wrong rather than being obvious
 * nonsense. The split is reported: a run that adopted everything, or fell back on everything, would
 * mean the mutators had stopped being interesting.
 *
 * Mutations: dropping `cursorSplit`'s offset guard, so `splitText` is called on whatever is at the
 * cursor, and letting a `MISMATCH` escape `tryAdopt` instead of falling back. Each throws within the
 * first few cases.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent',
])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { serializeTemplate } = await import('@verajs/ssr');

const D = dom.window.document;
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** One function per shape, so the server and client renders share a call site. */
const SHAPES = [
  ['text hole', (v) => html`<p>${v}</p>`],
  ['two holes', (v) => html`<p>${v}|${v}</p>`],
  ['text around holes', (v) => html`<p>a${v}b${v}c</p>`],
  ['attribute', (v) => html`<p class=${v}>t</p>`],
  ['nested', (v) => html`<div><span>${v}</span><b>t</b></div>`],
  ['list', (v) => html`<ul>${[v, v].map((x) => html`<li>${x}</li>`)}</ul>`],
  ['deep', (v) => html`<div><section><p><em>${v}</em></p></section></div>`],
];

/** How markup on a real page differs from what this client would have produced. */
const MUTATORS = [
  ['unchanged', (m) => m],
  ['a comment injected', (m) => `<!-- injected -->${m}`],
  ['a trailing element', (m) => `${m}<div class="banner">ad</div>`],
  ['a leading text node', (m) => `stray ${m}`],
  ['whitespace between tags', (m) => m.replace(/></g, '>\n  <')],
  ['an attribute added', (m) => m.replace(/<(\w+)/, '<$1 data-proxy="1"')],
  ['text truncated', (m) => m.slice(0, Math.max(1, Math.floor(m.length * 0.6)))],
  ['a tag renamed', (m) => m.replace(/<p>/g, '<div>').replace(/<\/p>/g, '</div>')],
  ['entities re-encoded', (m) => m.replace(/&/g, '&amp;').replace(/ /g, '&#32;')],
  ['an element unwrapped', (m) => m.replace(/<\/?span>/g, '')],
  ['empty', () => ''],
  ['only whitespace', () => '   \n  '],
  ['a lone close tag', (m) => `${m}</div>`],
  ['duplicated', (m) => m + m],
];

const VALUES = ['v', '', 0, null, undefined, false, 'multi word', '<i>', 42];
const SEEDS = [8, 24, 51, 96, 175, 4096];
const ROUNDS = 40;

test('hydration adopts or falls back for any markup, and never throws', () => {
  const problems = [];
  let cases = 0;
  let adopted = 0;
  let fellBack = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    for (let round = 0; round < ROUNDS; round++) {
      const [shapeName, shape] = SHAPES[Math.floor(random() * SHAPES.length)];
      const [mutatorName, mutate] = MUTATORS[Math.floor(random() * MUTATORS.length)];
      const value = VALUES[Math.floor(random() * VALUES.length)];
      cases++;

      let markup;
      try {
        markup = mutate(serializeTemplate(shape(value)));
      } catch (error) {
        problems.push(`seed ${seed}: building the case threw — ${error.message}`);
        continue;
      }

      const host = D.createElement('div');
      host.innerHTML = markup;
      const warnings = [];
      const originalWarn = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        hydrateInto(shape(value), host);
        if (warnings.some((line) => /fell back/.test(line))) fellBack++;
        else adopted++;
      } catch (error) {
        problems.push(
          `seed ${seed} ${shapeName} / ${mutatorName} / ${JSON.stringify(value)}\n` +
            `      threw ${error.constructor.name}: ${String(error.message).slice(0, 110)}\n` +
            `      markup: ${JSON.stringify(markup).slice(0, 120)}`
        );
      } finally {
        console.warn = originalWarn;
      }
    }
  }

  assert.equal(cases, SEEDS.length * ROUNDS, 'not every generated case ran');
  assert.deepEqual(
    problems.slice(0, 6),
    [],
    `${problems.length} of ${cases} hydrations threw instead of falling back:\n\n  ${problems.slice(0, 6).join('\n\n  ')}`
  );

  /**
   * Both outcomes have to occur, or the mutators have stopped being interesting: all-adopted would
   * mean nothing is being disturbed, all-fallback that nothing resembles the server's output. This is
   * a statement about the *generator*, and it is the assertion that would notice it going stale.
   *
   * The development build is what reports a fallback; production folds the diagnostic away, so the
   * count is only meaningful there. `adopted` is then everything, and the throw check above — which
   * is the actual subject — still runs in both.
   */
  if (!isProduction) {
    assert.ok(adopted > cases * 0.2, `only ${adopted} of ${cases} adopted — the mutators disturb every case`);
    assert.ok(fellBack > cases * 0.2, `only ${fellBack} of ${cases} fell back — the mutators disturb nothing`);
  }
});
