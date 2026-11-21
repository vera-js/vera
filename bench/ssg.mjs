/**
 * **Static-site build time: `astro build` against a Vera build script** — the same site both ways, timed from a cold
 * process to the last file on disk.
 *
 *   npm run build && (cd bench && npm install) && node bench/ssg.mjs     # PAGES=100,1000 RUNS=5 by default
 *
 * The site (`fixtures/ssg/data.mjs`): N pages, each a layout with a 10-link nav and 20 cards (title, a 16-word text,
 * three tags), no client JavaScript. Astro: `src/pages/[id].astro` with `getStaticPaths`, a Layout and a Card, static
 * output, its caches (`.astro`, `node_modules/.astro`, `node_modules/.vite`) and `dist` removed before every run. Vera:
 * `fixtures/ssg/vera/build.mjs`, `renderToString` per page with two light-DOM components, writing
 * `dist/<id>/index.html`, against this tree's BUILT packages (production: no `--conditions`). A byte-identical copy of
 * the Vera arm is the A/A: a ratio is printed only when the two copies agree within 5%. Both arms must write N pages,
 * and three sampled pages must hold the same text in both.
 *
 * The fixture is copied to a temporary directory so neither build writes into the repo. Caffeinated, paused and
 * thermal-gated by `scripts/heavy-batch.mjs`, like every timing tool here; background load is logged, not waited out.
 */
import { spawnSync, execSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heavyBatch } from '../scripts/heavy-batch.mjs';

const BENCH = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(BENCH, '..');
const SIZES = (process.env.PAGES ?? '100,1000').split(',').map(Number);
const RUNS = Number(process.env.RUNS ?? 5);

const work = mkdtempSync(join(tmpdir(), 'vera-ssg-'));
cpSync(join(BENCH, 'fixtures/ssg'), work, { recursive: true });
symlinkSync(join(BENCH, 'node_modules'), join(work, 'astro/node_modules'));
symlinkSync(join(ROOT, 'node_modules'), join(work, 'vera/node_modules'));
cpSync(join(work, 'vera'), join(work, 'vera-aa'), { recursive: true, verbatimSymlinks: true });

const ARMS = {
  astro: { cwd: join(work, 'astro'), args: ['node_modules/astro/bin/astro.mjs', 'build'], clean: ['dist', '.astro', 'node_modules/.astro', 'node_modules/.vite'] },
  vera: { cwd: join(work, 'vera'), args: ['build.mjs'], clean: ['dist'] },
  'vera-aa': { cwd: join(work, 'vera-aa'), args: ['build.mjs'], clean: ['dist'] },
};
const top = () => {
  try { return execSync('ps -Ao pcpu,comm -r', { encoding: 'utf8' }).split('\n').slice(1, 3).map((l) => l.trim().replace(/\s+/, ' ').slice(0, 50)).join(' ; '); }
  catch { return ''; }
};
let seed = 20261121;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), n = s.length; return n % 2 ? s[n >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2; };

const cool = heavyBatch('ssg');
console.log(`node ${process.version}; astro ${JSON.parse(readFileSync(join(BENCH, 'node_modules/astro/package.json'), 'utf8')).version}; ${RUNS} cold runs per arm per size; ${work}`);
const times = {};
for (const pages of SIZES) {
  const jobs = Object.keys(ARMS).flatMap((arm) => Array(RUNS).fill(arm));
  for (let i = jobs.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [jobs[i], jobs[j]] = [jobs[j], jobs[i]]; }
  for (const arm of jobs) {
    cool();
    const { cwd, args, clean } = ARMS[arm];
    for (const path of clean) rmSync(join(cwd, path), { recursive: true, force: true });
    const load = top();
    const start = process.hrtime.bigint();
    const run = spawnSync('node', args, { cwd, env: { ...process.env, PAGES: String(pages), ASTRO_TELEMETRY_DISABLED: '1' }, encoding: 'utf8', timeout: 300_000 });
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    /** Astro writes /404 and /500 as `404.html` and `500.html`, every other page as a folder. */
    const written = readdirSync(join(cwd, 'dist')).filter((f) => /^\d+(\.html)?$/.test(f)).length;
    if (run.status !== 0 || written !== pages) throw new Error(`${arm} at ${pages} pages: exit ${run.status}, ${written} pages written\n${run.stderr.slice(0, 800)}`);
    ((times[pages] ??= {})[arm] ??= []).push(ms);
    console.log(`  ${arm.padEnd(8)} ${String(pages).padStart(5)} pages ${ms.toFixed(0).padStart(6)} ms   load: ${load}`);
  }
}
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const last = SIZES.at(-1);
for (const id of [0, 7, last - 1]) {
  const read = (arm) => text(readFileSync(join(ARMS[arm].cwd, 'dist', String(id), 'index.html'), 'utf8'));
  if (read('astro') !== read('vera')) throw new Error(`page ${id}: the two builds hold different text`);
}
console.log('\n  pages   astro     vera   vera A/A   astro / vera');
for (const pages of SIZES) {
  const m = (arm) => median(times[pages][arm]);
  const aa = m('vera-aa') / m('vera') - 1;
  const ratio = Math.abs(aa) <= 0.05 ? `${(m('astro') / m('vera')).toFixed(1)}×` : `VOID (A/A ${(aa * 100).toFixed(1)}%)`;
  console.log(`  ${String(pages).padStart(5)} ${m('astro').toFixed(0).padStart(6)} ms ${m('vera').toFixed(0).padStart(6)} ms ${(aa * 100).toFixed(1).padStart(7)}%   ${ratio}`);
}
console.log(`  text equal on pages 0, 7 and ${last - 1}`);
rmSync(work, { recursive: true, force: true });
