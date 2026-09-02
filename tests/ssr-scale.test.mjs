/**
 * SSR at the sizes a real page reaches, and at the shapes that make a recursive walk fail.
 *
 * The nested-component scan walks emitted markup for tags the registry knows, so **depth is
 * recursion** — capped at 32 to catch a cycle. A page is a chain of components (page → section →
 * card → row → field), so ten levels has to be nowhere near that limit, and a thousand rows has to
 * be a render rather than an event.
 *
 * Timings are generous on purpose: this asserts the work is linear and finite, not that the machine
 * is fast. `bench/ssr.mjs` and `npm run metrics` own the numbers.
 */
import { renderToString, serializeTemplate } from '@verajs/ssr';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import assert from 'node:assert/strict';

const { html } = await import('@verajs/core');

let pass = 0;
const failures = [];
const check = (name, condition, extra = '') => (condition ? pass++ : failures.push(`${name} — ${extra}`));

/* ── a ten-level component chain ────────────────────────────────────────────────────────────── */
{
  const dir = mkdtempSync(new URL('./.scale-', import.meta.url).pathname);
  try {
    const DEPTH = 10;
    writeFileSync(
      `${dir}/nest.js`,
      `import { init, render, html } from '@verajs/core';
const DEPTH = ${DEPTH};
for (let level = DEPTH; level >= 1; level--) {
  const child = level < DEPTH ? \`<nest-\${level + 1}></nest-\${level + 1}>\` : '';
  customElements.define(\`nest-\${level}\`, class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      render(() => html\`<div data-level="\${String(level)}">\${html([child])}</div>\`);
    }
  });
}
export default customElements.get('nest-1');
`
    );
    const { html: markup } = await renderToString(new URL(`file://${dir}/nest.js`), { tag: 'nest-1' });
    const levels = [...markup.matchAll(/data-level="(\d+)"/g)].map(([, level]) => Number(level));
    check('a ten-level component chain renders every level', levels.join(',') === '1,2,3,4,5,6,7,8,9,10', levels.join(','));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/* ── scale ──────────────────────────────────────────────────────────────────────────────────── */
{
  const rows = Array.from({ length: 1000 }, (_, i) => ({ id: i, label: `row ${i}` }));
  const started = performance.now();
  const markup = serializeTemplate(html`<ul>${rows.map((row) => html`<li data-id=${row.id}>${row.label}</li>`)}</ul>`);
  const elapsed = performance.now() - started;
  check('a 1000-row list serializes every row', (markup.match(/<li /g) ?? []).length === 1000);
  check('and does it in linear time', elapsed < 250, `${elapsed.toFixed(1)} ms`);
}

{
  let template = html`<i>deepest</i>`;
  for (let i = 0; i < 200; i++) template = html`<div>${template}</div>`;
  const markup = serializeTemplate(template);
  check('200 nested templates serialize', markup.includes('deepest') && (markup.match(/<div>/g) ?? []).length === 200);
}

/* ── many islands sharing one `seen` ────────────────────────────────────────────────────────── */
{
  const entry = new URL('../examples/kitchen-sink/components/sink-scoped.js', import.meta.url);
  const seen = new Set();
  let withStyles = 0;
  for (let i = 0; i < 25; i++) {
    const { styles } = await renderToString(entry, { tag: 'sink-scoped', seen });
    if (styles) withStyles++;
  }
  check('25 islands of one component ship its CSS once', withStyles === 1, `${withStyles} of 25 carried styles`);
}

if (failures.length) {
  console.log(`\n  ${failures.length} scale failure(s):\n`);
  for (const failure of failures) console.log('    ' + failure);
}
console.log(`ssr scale: ${pass} checks across depth, size and islands`);
assert.equal(failures.length, 0);
