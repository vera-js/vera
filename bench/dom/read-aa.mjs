/**
 * **The A/A spread of a race record** (`race.mjs --json`), the number every harness change must shrink (2026-11-08).
 * Two arms that run the same bytes must read the same; how far they read apart is the noise floor a real effect has to
 * clear. Per engine and row:
 *   - `Δmed`: the race's own reading (median of the B arm's session medians over the A arm's), what a verdict uses;
 *   - `pair`: the per-session paired differences (B's median / A's median − 1): their median, and their spread
 *     (max |d| and standard deviation), which is the spread a verdict on N sessions has to beat;
 *   - `cv`: within one page, the median coefficient of variation of a row's samples (the repeat-to-repeat noise);
 *   - `≥2×`: how many samples read at least twice their page's median (collections or other cleanup landing in one).
 * Refuses a record with a non-finite sample (a failed row must never read as a narrower spread).
 *
 *   node bench/dom/read-aa.mjs <record.json> [A=BASE] [B=BASEaa] [impl=VeraJS own]
 */
import { readFileSync } from 'node:fs';

const [file, A = 'BASE', B = 'BASEaa', IMPL = 'VeraJS own'] = process.argv.slice(2);
const record = JSON.parse(readFileSync(file, 'utf8'));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => Math.sqrt(xs.reduce((a, x) => a + (x - mean(xs)) ** 2, 0) / Math.max(1, xs.length - 1));
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(2)}%`;
const finite = (xs, where) => {
  for (const x of xs) if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`non-finite sample ${JSON.stringify(x)} at ${where}`);
  return xs;
};

for (const [engine, byEngine] of Object.entries(record)) {
  const data = byEngine.data?.[IMPL];
  const runs = byEngine.runs?.[IMPL];
  if (!data) continue;
  console.log(`\n== ${engine} / ${IMPL}: ${B} vs ${A}, ${byEngine.sessions ?? data[Object.keys(data)[0]][A].length} sessions`);
  console.log(`  ${'row'.padEnd(14)}${'Δmed'.padStart(9)}${'pair med'.padStart(10)}${'max|d|'.padStart(9)}${'sd(d)'.padStart(8)}${'cv A'.padStart(8)}${'cv B'.padStart(8)}${'≥2×'.padStart(7)}`);
  const summary = [];
  for (const [op, byArm] of Object.entries(data)) {
    const a = finite(byArm[A], `${engine}.${op}.${A}`);
    const b = finite(byArm[B], `${engine}.${op}.${B}`);
    const d = a.map((x, s) => b[s] / x - 1);
    const dMed = median(b) / median(a) - 1;
    const pages = (arm) => runs[op][arm].map((xs, s) => finite(xs, `${engine}.${op}.${arm}[${s}]`));
    const cv = (arm) => median(pages(arm).map((xs) => sd(xs) / mean(xs)));
    const high = [A, B].flatMap((arm) => pages(arm).flatMap((xs) => xs.filter((x) => x >= 2 * median(xs)))).length;
    const total = [A, B].flatMap((arm) => pages(arm).flat()).length;
    const maxD = Math.max(...d.map(Math.abs));
    summary.push(maxD);
    console.log(`  ${op.padEnd(14)}${pct(dMed).padStart(9)}${pct(median(d)).padStart(10)}${pct(maxD).padStart(9)}${pct(sd(d)).padStart(8)}${pct(cv(A)).padStart(8)}${pct(cv(B)).padStart(8)}${`${high}/${total}`.padStart(7)}`);
  }
  console.log(`  rows with max|d| ≤ 1%: ${summary.filter((x) => x <= 0.01).length}/${summary.length}; median max|d| ${pct(median(summary))}`);
}
