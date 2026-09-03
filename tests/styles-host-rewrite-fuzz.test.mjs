/**
 * **The light-DOM `:host` rewrite, against generated stylesheets.**
 *
 * `@verajs/styles` rewrites `:host` to `:scope` when hoisting a light component's `static styles`,
 * because `:host` is how a web component styles its own element and matches nothing outside a
 * shadow root. It is a TEXT rewrite over CSS an author wrote, which is the kind of thing that
 * deserves more than hand-picked cases: it must never touch a value, never touch an escaped
 * identifier, and never emit a selector the CSSOM will silently drop.
 *
 * Invariants rather than expected output, so the test does not become a second implementation of
 * the rule it is checking:
 *
 *   1. `:scope(` never appears — it is not a selector, and a rule carrying it is dropped in silence.
 *   2. A `:host` inside a string or a `url()` survives verbatim; those are values, not selectors.
 *   3. `:host-context()` is untouched — Firefox and WebKit never shipped it.
 *   4. `.md\:host` is untouched — an escaped identifier is a class name, and Tailwind emits them.
 *   5. The brace count is preserved, so no rule was gained or lost.
 *
 * Each run reports how many generated sheets actually contained each interesting shape, because a
 * corpus of `.plain { margin: 0 }` would satisfy every invariant above and prove nothing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent',
  'MutationObserver', 'Comment', 'Text',
]) {
  globalThis[key] = dom.window[key];
}

const { wire, init, render, html, css } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
wire([renderer, styles]);
const doc = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

const SELECTORS = [':host', ':host(.a)', ':host-context(.z)', '.plain', 'p', ':is(:host, .x)', '.md\\:host', 'a:hover'];
const DECLARATIONS = ['color: red', 'content: ":host"', 'background: url(/x/:host.png)', 'margin: 0'];
const VALUE_HOST = /content: ":host"|url\(\/x\/:host\.png\)/g;

test('the :host rewrite never touches a value, an escaped identifier, or the rule count', async () => {
  let seed = 424242;
  const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const pick = (list) => list[Math.floor(random() * list.length)];

  /** The package warns once about the missing `@scope` under jsdom; it is expected, not the subject. */
  const originalWarn = console.warn;
  console.warn = () => {};

  const violations = [];
  let withHostSelector = 0;
  let withHostValue = 0;
  let withEscaped = 0;
  const RUNS = 300;
  try {
    for (let run = 0; run < RUNS; run++) {
      const source = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        `${pick(SELECTORS)}${random() < 0.3 ? ` ${pick(['b', '.c', '> i'])}` : ''} { ${pick(DECLARATIONS)}; ${pick(DECLARATIONS)} }`
      ).join('\n');

      const tag = `fuzz-host-${run}`;
      customElements.define(
        tag,
        class extends dom.window.HTMLElement {
          static styles = css([source]);
          connectedCallback() {
            init(this); // LIGHT — the rewrite only runs for a host with no shadow root
            render(() => html`<p>x</p>`);
          }
        }
      );
      doc.body.append(doc.createElement(tag));
      await frame();
      const out = [...doc.head.querySelectorAll('style')].pop()?.textContent ?? '';

      if (/(^|[^\\-]):host(\s|\{|\()/.test(source)) withHostSelector++;
      const valuesIn = (source.match(VALUE_HOST) ?? []).length;
      if (valuesIn > 0) withHostValue++;
      if (source.includes('.md\\:host')) withEscaped++;

      const problems = [];
      if (out.includes(':scope(')) problems.push('emitted `:scope(`, which is not a selector');
      if (valuesIn !== (out.match(VALUE_HOST) ?? []).length) problems.push('rewrote a value');
      if ((source.match(/:host-context/g) ?? []).length !== (out.match(/:host-context/g) ?? []).length)
        problems.push('rewrote `:host-context()`');
      if ((source.match(/\.md\\:host/g) ?? []).length !== (out.match(/\.md\\:host/g) ?? []).length)
        problems.push('rewrote an escaped identifier');
      if ((source.match(/\{/g) ?? []).length !== (out.match(/\{/g) ?? []).length)
        problems.push('changed the rule count');
      if (problems.length > 0) violations.push({ run, problems, source, out });
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.ok(withHostSelector > RUNS / 5,
    `CONTROL: only ${withHostSelector} of ${RUNS} sheets had a :host SELECTOR — the run proves little`);
  assert.ok(withHostValue > RUNS / 5,
    `CONTROL: only ${withHostValue} sheets had :host in a VALUE, which is the case most at risk`);
  assert.ok(withEscaped > 10, `CONTROL: only ${withEscaped} sheets had an escaped identifier`);
  assert.deepEqual(violations, [], 'a rewrite of author CSS must not change anything but selectors');
});
