/**
 * One command for the numbers an audit pass has to state: size and speed, against the last pass.
 *
 *   node scripts/metrics.mjs              # measure, print, compare with the recorded baseline
 *   node scripts/metrics.mjs --record     # measure and make this the baseline
 *
 * `docs/CODE-PRINCIPLES.md` #4 and #7 ask for before/after on anything that moves either, and this
 * repo has been bitten twice by numbers nobody was watching: a 36% serializer regression accumulated
 * one correctness fix at a time, and size claims that drifted 58% from what the build produced.
 * Both were invisible because measuring meant remembering to.
 *
 * Sizes come from the built bundles. Speed comes from the benchmarks that do not need the `bench/`
 * dependencies, so this runs on a clean `npm ci`; the cross-framework comparisons live in
 * `bench/ssr.mjs` and `bench/renderer-vs-lit.mjs` and are reported separately.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const baselinePath = new URL('./bench/metrics-baseline.json', root);
const record = process.argv.includes('--record');

const BUNDLES = {
  core: 'packages/core/dist/vera.min.js',
  renderer: 'packages/renderer/dist/vera-renderer.min.js',
  'renderer/hydrate': 'packages/renderer/dist/vera-renderer-hydrate.min.js',
  'renderer/spread': 'packages/renderer/dist/vera-renderer-spread.min.js',
  router: 'packages/router/dist/vera-router.min.js',
  autoloader: 'packages/autoloader/dist/vera-autoloader.min.js',
  styles: 'packages/styles/dist/vera-styles.min.js',
  inserts: 'packages/inserts/dist/vera-inserts.min.js',
};

const size = {};
for (const [name, path] of Object.entries(BUNDLES)) {
  const file = new URL(path, root);
  if (!existsSync(file)) continue;
  size[name] = gzipSync(readFileSync(file)).length;
}
size['core+renderer'] = (size.core ?? 0) + (size.renderer ?? 0);

/**
 * Timed in a child process so the measurement cannot be perturbed by whatever this one has already
 * loaded, and taken as the **fastest** of several rounds: noise is one-sided.
 */
const speedScript = `
import { serializeTemplate, renderToString } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const rows = Array.from({ length: 100 }, (_, i) => ({ id: i, label: \`row \${i} <safe>\` }));
const small = () => html\`<section class="wrap"><h1>\${'hello'}</h1><output>count: \${3}</output><input .value=\${'hello'} /></section>\`;
const large = () => html\`<table><tbody>\${rows.map((r) => html\`<tr class=\${r.id % 2 ? 'odd' : 'even'}><td>\${r.id}</td><td>\${r.label}</td></tr>\`)}</tbody></table>\`;
const best = (run, n, rounds = 7) => {
  for (let i = 0; i < n; i++) run();
  let fastest = Infinity;
  for (let round = 0; round < rounds; round++) {
    const t0 = performance.now();
    for (let i = 0; i < n; i++) run();
    fastest = Math.min(fastest, ((performance.now() - t0) / n) * 1000);
  }
  return Number(fastest.toFixed(3));
};
const url = new URL('../tests/fixtures/ssr/hello-ssr.js', import.meta.url);
await renderToString(url);
const out = {
  'serialize small': best(() => serializeTemplate(small()), 20000),
  'serialize table': best(() => serializeTemplate(large()), 500),
};
const t0 = performance.now();
for (let i = 0; i < 4000; i++) await renderToString(url);
out['renderToString'] = Number((((performance.now() - t0) / 4000) * 1000).toFixed(3));
process.stdout.write(JSON.stringify(out));
`;

const speed = JSON.parse(
  execFileSync(process.execPath, ['--conditions', 'development', '--input-type=module', '-e', speedScript], {
    cwd: new URL('./scripts/', root).pathname,
    encoding: 'utf8',
  })
);

const current = { size, speed };
const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : null;

const delta = (now, then, unit) => {
  if (then == null) return '     (new)';
  const change = now - then;
  if (!change) return '          —';
  const percent = then ? ((change / then) * 100).toFixed(1) : '∞';
  return `${change > 0 ? '+' : ''}${change}${unit} (${change > 0 ? '+' : ''}${percent}%)`;
};

console.log('\n  size — gzipped bundle bytes');
for (const [name, bytes] of Object.entries(size))
  console.log(`  ${name.padEnd(18)} ${String(bytes).padStart(6)} B   ${delta(bytes, baseline?.size?.[name], ' B')}`);

console.log('\n  speed — µs, fastest of 7 rounds');
for (const [name, microseconds] of Object.entries(speed))
  console.log(
    `  ${name.padEnd(18)} ${String(microseconds).padStart(8)} µs  ${delta(microseconds, baseline?.speed?.[name], ' µs')}`
  );

if (record) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
  console.log('\n  recorded as the baseline\n');
} else if (!baseline) {
  console.log('\n  no baseline yet — run with --record\n');
} else {
  console.log('');
}
