/**
 * SSR throughput: vera-native vs react-dom/server vs vue/server-renderer vs @lit-labs/ssr.
 *
 * Methodology (house style): contenders run in ROTATED rounds so GC pressure spreads evenly;
 * the headline is the FASTEST round (noise is one-sided), the median is shown alongside.
 * Two fixtures: a small component (hero + form state) and a 100-row table.
 *
 * Fairness notes:
 * - Server throughput only. Hydration is client-side work and is excluded for everyone alike
 *   (React/Vue markup is hydratable by their clients; vera's client takeover is currently a
 *   re-render — renderer `hydrate()` is a known TODO and does not affect these numbers).
 * - `vera-native` renders a REAL web component (instantiate + store + hooks + shadow serialization)
 *   into declarative shadow DOM. **No other row does** — react/vue serialize a vdom, lit renders a
 *   lit-html template with hydration markers. `vera templates` is the row that compares like for
 *   like against them; reading `vera-native` against `lit ssr` is reading a component pipeline
 *   against a template render, and 94% of the former is core's lifecycle rather than serialization.
 *   A LitElement row would make that comparison honest and is the obvious next addition here.
 * - Vue compiles templates once (its global compile cache) — its numbers are its compiled path.
 *
 *   node bench/ssr.mjs
 */
import { execFileSync } from 'node:child_process';
import { renderToString as veraRender, serializeTemplate } from '@verajs/ssr/vera';
/** Resolved once, at load, exactly as every other contender's renderer is. */
const { html } = await import('@verajs/core');
import { createElement as h } from 'react';
import { renderToString as reactRender } from 'react-dom/server';
import { createSSRApp } from 'vue';
import { renderToString as vueRender } from 'vue/server-renderer';

/** vera's shims are installed above; lit's SSR needs one extra stub on our minimal document. */
import './lit-tree-walker-stub.mjs';
import { render as litRender } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { html as litHtml } from 'lit-html';

const ROUNDS = 7;
const SMALL_N = 1500;
const LARGE_N = 200;

const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i} <safe>` }));

const CONTENDERS = {
  /**
   * Template flattening alone — the symmetrical comparison to the lit/react/vue rows, which also
   * measure template/vdom serialization without any component lifecycle.
   *
   * The two `await import()`s these bodies used to carry were **inside the timed function**, while
   * every other contender's modules were resolved at load. Node had the modules cached, but each
   * call still built two promises and yielded twice: 4.84 µs measured against 0.28 µs for the same
   * work with the lookups hoisted. The row was reporting seventeen times its own cost and losing to
   * lit on a number that was almost entirely benchmark overhead.
   */
  'vera templates': {
    small: () =>
      serializeTemplate(
        html`<section class="wrap"><h1>${'hello from the server'}</h1><output>count: ${3}</output><input .value=${'hello from the server'} /></section>`
      ),
    large: () =>
      serializeTemplate(
        html`<table><tbody>${rows.map(
          (row) => html`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`
        )}</tbody></table>`
      ),
  },
  /** The full pipeline: instantiate the element, run init/store/hooks, serialize, scan for
   * nested registered tags — the only row here that renders an actual component. */
  'vera-native': {
    small: (() => {
      const url = new URL('../tests/fixtures/ssr/hello-ssr.js', import.meta.url);
      return () => veraRender(url);
    })(),
    large: (() => {
      const url = new URL('../tests/fixtures/ssr/rows-ssr.js', import.meta.url);
      return () => veraRender(url);
    })(),
  },
  'react 19': {
    small: () =>
      reactRender(
        h('section', { className: 'wrap' },
          h('h1', null, 'hello from the server'),
          h('output', null, 'count: ', 3),
          h('input', { defaultValue: 'hello from the server' }))
      ),
    large: () =>
      reactRender(
        h('table', null, h('tbody', null,
          rows.map((row) =>
            h('tr', { key: row.id, className: row.id % 2 ? 'odd' : 'even' },
              h('td', null, row.id), h('td', null, row.label)))))
      ),
  },
  'vue 3.5': {
    small: () =>
      vueRender(createSSRApp({
        data: () => ({ greeting: 'hello from the server', count: 3 }),
        template: `<section class="wrap"><h1>{{ greeting }}</h1><output>count: {{ count }}</output><input :value="greeting" /></section>`,
      })),
    large: () =>
      vueRender(createSSRApp({
        data: () => ({ rows }),
        template: `<table><tbody><tr v-for="row in rows" :key="row.id" :class="row.id % 2 ? 'odd' : 'even'"><td>{{ row.id }}</td><td>{{ row.label }}</td></tr></tbody></table>`,
      })),
  },
  'lit ssr': {
    small: () =>
      collectResultSync(litRender(
        litHtml`<section class="wrap"><h1>${'hello from the server'}</h1><output>count: ${3}</output><input .value=${'hello from the server'} /></section>`
      )),
    large: () =>
      collectResultSync(litRender(
        litHtml`<table><tbody>${rows.map(
          (row) => litHtml`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`
        )}</tbody></table>`
      )),
  },
};

const results = {};
for (const size of ['small', 'large']) {
  const iterations = size === 'small' ? SMALL_N : LARGE_N;
  const perContender = {};
  for (const name of Object.keys(CONTENDERS)) perContender[name] = [];

  /** Warmup, then rotated rounds. */
  for (const name of Object.keys(CONTENDERS)) {
    for (let i = 0; i < 50; i++) await CONTENDERS[name][size]();
  }
  for (let round = 0; round < ROUNDS; round++) {
    for (const name of Object.keys(CONTENDERS)) {
      const run = CONTENDERS[name][size];
      const t0 = performance.now();
      for (let i = 0; i < iterations; i++) await run();
      perContender[name].push((performance.now() - t0) / iterations);
    }
  }
  results[size] = perContender;
}

/**
 * The LitElement row, measured in a process of its own — see `bench/lit-element-ssr.mjs` for why it
 * cannot share this one. It is the only row besides `vera-native` that renders an actual component,
 * so it is the comparison worth reading; everything else here serializes a template or a vdom.
 *
 * Timings come back in µs and are stored in ms to match the rest.
 */
try {
  const child = execFileSync(process.execPath, [
    new URL('./lit-element-ssr.mjs', import.meta.url).pathname,
    JSON.stringify({ rounds: ROUNDS, small: SMALL_N, large: LARGE_N }),
  ], { encoding: 'utf8' });
  const litElement = JSON.parse(child);
  for (const size of ['small', 'large']) {
    results[size]['lit element'] = [litElement[size].fastest / 1000, litElement[size].median / 1000];
  }
} catch (error) {
  console.log(`\n  (lit element row skipped: ${String(error.message).split('\n')[0]})`);
}

const fmt = (ms) => (ms * 1000).toFixed(1).padStart(8);
for (const size of ['small', 'large']) {
  console.log(`\n  ${size === 'small' ? 'small component' : '100-row table'} — µs/render, fastest of ${ROUNDS} rounds (median in parens)`);
  const entries = Object.entries(results[size])
    .map(([name, times]) => {
      const sorted = [...times].sort((a, b) => a - b);
      return { name, best: sorted[0], median: sorted[Math.floor(sorted.length / 2)] };
    })
    .sort((a, b) => a.best - b.best);
  const fastest = entries[0].best;
  for (const { name, best, median } of entries) {
    console.log(`  ${name.padEnd(13)} ${fmt(best)}  (${fmt(median).trim()})   ${(best / fastest).toFixed(2)}x`);
  }
}
