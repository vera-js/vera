/**
 * The LitElement row of `bench/ssr.mjs`, run in a process of its own.
 *
 * It cannot share one with the rest: `@verajs/ssr` installs a minimal `document`/`HTMLElement` at
 * import time, `@lit-labs/ssr` installs its own fuller shim, and whichever loses leaves the other
 * broken — lit-html already needs `bench/lit-tree-walker-stub.mjs` just to evaluate against vera's
 * document, and `LitElement` needs more of the DOM than that stub provides. Isolation is the only
 * way to measure a real LitElement against a real Vera component rather than against a template.
 *
 * Same method as the parent — fastest of N rounds — and the numbers are merged into its table.
 * Prints one line of JSON on stdout and nothing else.
 *
 *   node bench/lit-element-ssr.mjs '{"rounds":7,"small":1500,"large":200}'
 */
import '@lit-labs/ssr/lib/install-global-dom-shim.js';
import { render as litRender } from '@lit-labs/ssr';
import { collectResultSync } from '@lit-labs/ssr/lib/render-result.js';
import { html, LitElement } from 'lit';

const { rounds = 7, small = 1500, large = 200 } = JSON.parse(process.argv[2] ?? '{}');
const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, label: `row ${i} <safe>` }));

/** The same content `tests/fixtures/ssr/hello-ssr.js` renders, as a LitElement. */
class LitHero extends LitElement {
  static properties = { heading: {}, count: { type: Number } };
  constructor() {
    super();
    this.heading = 'hello from the server';
    this.count = 3;
  }
  render() {
    return html`<section class="wrap"><h1>${this.heading}</h1><output>count: ${this.count}</output
      ><input .value=${this.heading} /></section>`;
  }
}
customElements.define('lit-hero', LitHero);

/** And the 100-row table, as a component rather than a bare template. */
class LitRows extends LitElement {
  static properties = { rows: { type: Array } };
  constructor() {
    super();
    this.rows = rows;
  }
  render() {
    return html`<table>
      <tbody>
        ${this.rows.map(
          (row) => html`<tr class=${row.id % 2 ? 'odd' : 'even'}><td>${row.id}</td><td>${row.label}</td></tr>`
        )}
      </tbody>
    </table>`;
  }
}
customElements.define('lit-rows', LitRows);

const measure = (fn, iterations) => {
  for (let i = 0; i < Math.min(iterations, 200); i++) fn();
  const timings = [];
  for (let round = 0; round < rounds; round++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    timings.push(((performance.now() - start) / iterations) * 1000);
  }
  timings.sort((a, b) => a - b);
  return { fastest: timings[0], median: timings[Math.floor(timings.length / 2)] };
};

process.stdout.write(
  JSON.stringify({
    small: measure(() => collectResultSync(litRender(html`<lit-hero></lit-hero>`)), small),
    large: measure(() => collectResultSync(litRender(html`<lit-rows></lit-rows>`)), large),
  })
);
