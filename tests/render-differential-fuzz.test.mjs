/**
 * Generated shapes, rendered both ways and compared: client render against SSR + hydrate.
 *
 * **Every other suite here is example-based** — a person thought of a case and wrote it down, which
 * finds what someone imagined. This walks a grid instead: fifteen template shapes crossed with eleven
 * interpolated values, over six seeds, so the combinations are ones nobody chose. Empty strings next
 * to adjacent holes, `false` in an attribute, markup-shaped text inside a nested list.
 *
 * **Seeded, deliberately.** `CLAUDE.md` warns that an unseeded generator turns a DOM-shape-dependent
 * failure into an intermittent one, and that bisecting those produces contradictory results. The seed
 * and the exact values are printed with any failure, so a case replays on demand.
 *
 * **What it asserts is not only that the DOM matches.** A hydration *fallback* is also a failure
 * here: the page is correct either way, so a DOM comparison alone cannot see it — the server's work
 * was simply thrown away and re-done. Removing SSR's text escaping is caught by exactly that check
 * and by nothing else in this file, which is what makes it worth having.
 *
 * **What it does not reach**, stated so nobody reads a green run as broader than it is. Breaking
 * `passComments` in `hydrate.ts` leaves this suite passing: server output is markerless and these
 * shapes emit no comments, so the comment-stepping path is never entered. That case belongs to
 * `tests/hydrate-mismatch.test.mjs`, which carries it deliberately. Nor does this cover directives
 * (`keyed`, `spread`, `hold`), events, or updates after the first render — every case here renders
 * once.
 */
import { load, isProduction } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const { html } = await load('core');
const { renderInto } = await load('renderer');
const { renderInto: hydrateInto } = await load('renderer/hydrate');
const { serializeTemplate } = await import('@verajs/ssr');

const D = dom.window.document;

/** A deterministic LCG, so a failing case replays from its seed alone. */
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

const VALUES = ['v', '', 0, 1, null, undefined, false, true, 'multi word', '<i>', 42];

/**
 * Each shape is **one function**, so both renders go through one call site.
 *
 * That is the whole reason this is a fixed list rather than a generated tree: template identity is
 * the `strings` array interned per call site, so a generator emitting a fresh literal each time would
 * compare two different templates and every conclusion drawn would be wrong in the same direction.
 */
const SHAPES = [
  ['single hole', (v) => html`<p>${v[0]}</p>`],
  ['two holes, adjacent', (v) => html`<p>${v[0]}${v[1]}</p>`],
  ['two holes, text between', (v) => html`<p>${v[0]} and ${v[1]}</p>`],
  ['hole at start and end', (v) => html`<p>${v[0]}mid${v[1]}</p>`],
  ['attribute binding', (v) => html`<p class=${v[0]}>t</p>`],
  ['attribute among statics', (v) => html`<p id="a" class=${v[0]} data-x="b">t</p>`],
  ['two attributes', (v) => html`<p class=${v[0]} title=${v[1]}>t</p>`],
  ['boolean binding', (v) => html`<input ?disabled=${v[0]}>`],
  ['property binding', (v) => html`<input .value=${String(v[0] ?? '')}>`],
  ['nested elements', (v) => html`<div><span>${v[0]}</span><b>${v[1]}</b></div>`],
  ['deep nesting', (v) => html`<div><section><p><em>${v[0]}</em></p></section></div>`],
  ['a list', (v) => html`<ul>${[v[0], v[1]].map((x) => html`<li>${x}</li>`)}</ul>`],
  ['nested template in a hole', (v) => html`<div>${html`<i>${v[0]}</i>`}</div>`],
  ['sibling holes across elements', (v) => html`<div><p>${v[0]}</p>text<p>${v[1]}</p></div>`],
  ['hole holding a list and text', (v) => html`<div>lead${[v[0]].map((x) => html`<i>${x}</i>`)}tail</div>`],
];

/**
 * Two differences are known, documented and benign, and the comparison normalises both — otherwise
 * it reports the same two findings three hundred times and buries anything real underneath.
 *
 * 1. **Attribute order.** The client appends a bound attribute after the statics; the server emits
 *    source order. Order carries no meaning in HTML, the DOMs are equivalent, and hydration does not
 *    fall back on it — only `innerHTML` serialisation differs.
 * 2. **Form-state reflection.** `tests/hydrate-parity.test.mjs` holds the list of four cases where a
 *    hydrated DOM is legitimately not byte-identical — `input .value`, `input .checked`,
 *    `option .selected`, `textarea` content — because markup is the only way form state reaches the
 *    client at all.
 *
 * Comments are excluded in both directions, which is how hydration itself treats them.
 */
const FORM_STATE = /^(value|checked|selected)$/;
const canonical = (host) => {
  const out = [];
  const walk = (node, depth) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) out.push(`${depth}text ${JSON.stringify(child.data)}`);
      else if (child.nodeType === 1) {
        const attributes = [...child.attributes]
          .filter((attribute) => !FORM_STATE.test(attribute.name))
          .map((attribute) => `${attribute.name}=${attribute.value}`)
          .sort();
        out.push(`${depth}<${child.localName} ${attributes.join(' ')}>`);
        walk(child, depth + 1);
      }
    }
  };
  walk(host, 0);
  return out.join('\n');
};

const SEEDS = [1, 7, 13, 42, 99, 12345];
const ROUNDS = 60;

test('generated templates hydrate to what the client renders, without falling back', () => {
  const failures = [];
  let cases = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    for (let round = 0; round < ROUNDS; round++) {
      const [name, shape] = SHAPES[round % SHAPES.length];
      const values = [
        VALUES[Math.floor(random() * VALUES.length)],
        VALUES[Math.floor(random() * VALUES.length)],
      ];
      const where = `seed ${seed}, ${name}, values ${JSON.stringify(values)}`;
      cases++;

      const clientHost = D.createElement('div');
      renderInto(shape(values), clientHost);
      const client = canonical(clientHost);

      let markup;
      try {
        markup = serializeTemplate(shape(values));
      } catch (error) {
        failures.push(`${where}\n      SSR threw: ${error.message}`);
        continue;
      }

      const hydrateHost = D.createElement('div');
      hydrateHost.innerHTML = markup;
      const warnings = [];
      const original = console.warn;
      console.warn = (...args) => warnings.push(args.join(' '));
      try {
        hydrateInto(shape(values), hydrateHost);
      } catch (error) {
        failures.push(`${where}\n      hydrate threw: ${error.message}`);
        continue;
      } finally {
        console.warn = original;
      }

      const hydrated = canonical(hydrateHost);
      if (hydrated !== client) {
        failures.push(`${where}\n      client:   ${JSON.stringify(client)}\n      hydrated: ${JSON.stringify(hydrated)}`);
        continue;
      }

      /**
       * The page is correct either way, so this is invisible to the comparison above — and it is the
       * failure that matters most, because the server's work was thrown away for nothing. Skipped
       * under production, where the diagnostic is folded out of the build.
       */
      if (!isProduction) {
        const fallback = warnings.find((warning) => /fell back/.test(warning));
        if (fallback) failures.push(`${where}\n      DOM correct, but hydration fell back: ${fallback.slice(0, 140)}`);
      }
    }
  }

  assert.equal(cases, SEEDS.length * ROUNDS, 'the generator did not produce the expected number of cases');
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} of ${cases} generated cases disagree:\n\n  ${failures.slice(0, 10).join('\n\n  ')}`);
});
