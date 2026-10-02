/**
 * **Server-render speed, before and after a change: cold AND steady, never a window.**
 *
 *   npm run build && node bench/ssr-scan.mjs --compare <git ref>     # e.g. --compare 46060d3
 *   node bench/ssr-scan.mjs --compare <ref> --rounds 10 --only content,compile
 *
 * `--compare` builds `@verajs/ssr` from that ref (its own `src`, compiled by its own `tsconfig`, or used as-is when the
 * ref predates the TypeScript conversion) into `bench/.cache/`, inside this tree so it resolves the SAME
 * `@verajs/core` as HEAD — only ssr differs. Three variants then run, each workload in a FRESH process per round, in a
 * seeded shuffled order: the ref, HEAD's `packages/ssr/dist`, and a byte-identical copy of HEAD as the A/A control.
 *
 * Each process reports TWO numbers, because one window measures the wrong thing (see CLAUDE.md): **cold**, the total of
 * the first calls from a new process — what a server's first requests pay, tier-up included — and **steady**, the time
 * per call after a long warm-up — what throughput pays. A fixed window after a fixed warm-up reported a change 28%
 * slower that was faster on both. If the A/A spread is past 2% the machine was busy (a build, Spotlight indexing what
 * one wrote) and the run says so instead of a verdict.
 *
 * The four workloads: a 50 KB trusted `.innerHTML` value (the inertness scan), compiling 200 distinct templates, a
 * page of 100 nested components, and a long article with one component (`bench/fixtures/ssr-scan/`).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cache = fileURLToPath(new URL('./.cache/', import.meta.url));
const flag = (name) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? undefined : process.argv[at + 1];
};

/** ---- the child: one workload, one fresh process, two numbers ---- */
if (process.argv[2] === '--child') {
  const [, , , entry, workload] = process.argv;
  /** Every file read once first, so no variant pays for a colder OS cache than another. */
  const dir = new URL('.', `file://${entry}`);
  for (const f of readdirSync(dir)) if (f.endsWith('.js')) readFileSync(new URL(f, dir));
  const { serializeTemplate, renderToString } = await import(`file://${entry}`);
  let seed = 7;
  const rnd = (n) => ((seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff) % n);
  const words = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor'.split(' ');
  const w = (n) => Array.from({ length: n }, () => words[rnd(words.length)]).join(' ');
  const literal = (statics) => Object.assign([...statics], { raw: [...statics] });
  const time = async (run, coldCalls, warmCalls, steadyCalls) => {
    const c0 = performance.now();
    for (let i = 0; i < coldCalls; i++) await run(i);
    const cold = performance.now() - c0;
    for (let i = 0; i < warmCalls; i++) await run(i);
    const s0 = performance.now();
    for (let i = 0; i < steadyCalls; i++) await run(i);
    return [cold, (performance.now() - s0) / steadyCalls];
  };
  /** A server yields between requests; a loop that never does keeps every WeakRef target alive (see CLAUDE.md). */
  const yieldEvery = (i) => (i % 25 === 24 ? new Promise((r) => setImmediate(r)) : undefined);
  let result;
  if (workload === 'content') {
    let post = '';
    while (post.length < 50000) {
      const k = rnd(6);
      post +=
        k === 0 ? `<h2 id="s${post.length}">${w(4)}</h2>`
        : k === 1 ? `<p>${w(40)} <a href="https://example.com/${w(1)}" title="${w(3)}">${w(2)}</a> ${w(20)} <em>${w(2)}</em>.</p>`
        : k === 2 ? `<pre><code class="lang-js">const a = b &lt; c; // ${w(6)}</code></pre>`
        : k === 3 ? `<!-- ${w(5)} -->`
        : k === 4 ? `<figure><svg viewBox="0 0 9 9"><foreignObject><p>${w(3)}</p></foreignObject></svg><img src="/i.jpg" alt="${w(5)}"></figure>`
        : `<ul><li>${w(6)}</li></ul>`;
    }
    const host = literal(['<div .innerHTML=', '></div>']);
    result = await time(() => serializeTemplate({ ['_$litType$']: 1, strings: host, values: [post] }), 100, 400, 1000);
  } else if (workload === 'compile') {
    /** Fresh strings arrays every call, so every call compiles: 200 distinct templates per call. */
    const statics = Array.from({ length: 200 }, (_, i) => [
      `<article class="card c${i}" data-id="`, `"><header><h2 title="${w(3)}">`, `</h2><a href="/p/`, `" class="more">${w(2)}</a></header><p>${w(20)}</p><ul>`,
      `</ul><footer><button type="button" ?disabled=`, ` @click=`, `>${w(1)}</button><img src="/i/${i}.png" alt="${w(4)}"></footer></article>`]);
    const fn = () => {};
    result = await time(() => {
      for (const s of statics) serializeTemplate({ ['_$litType$']: 1, strings: literal(s), values: [1, 'x', [], false, fn] });
    }, 5, 40, 60);
  } else {
    const page = new URL(`./fixtures/ssr-scan/${workload}.js`, import.meta.url);
    result = await time(async (i) => {
      await renderToString(page, {});
      await yieldEvery(i);
    }, 100, 300, 200);
  }
  console.log(JSON.stringify(result));
  process.exit(0);
}

/**
 * **Waits for a quiet machine before it times anything.** A build writes files, and on macOS Spotlight then indexes
 * them at up to 150% CPU for a minute or two — the reproduce line itself starts with `npm run build`. So this polls
 * the indexer (and everything else) until it has stayed under 10% for 30 seconds, gives up after five minutes, and
 * prints what it saw either way, so a busy row in the table has a cause the reader can see.
 */
const quiet = () => {
  if (platform() !== 'darwin') return console.log(`  load average ${loadavg()[0].toFixed(2)} (no indexer check off macOS)`);
  const indexer = () =>
    execFileSync('ps', ['-Ao', 'pcpu,comm'], { encoding: 'utf8' })
      .split('\n')
      .filter((line) => /mds|mdworker|corespotlightd/.test(line))
      .reduce((total, line) => total + (Number.parseFloat(line) || 0), 0);
  const started = Date.now();
  let calm = 0;
  let last = 0;
  while (calm < 30 && Date.now() - started < 300_000) {
    last = indexer();
    calm = last < 10 ? calm + 2 : 0;
    if (calm < 30) execFileSync('sleep', ['2']);
  }
  console.log(`  Spotlight ${last.toFixed(0)}% CPU, load average ${loadavg()[0].toFixed(2)}${calm < 30 ? ' — STILL BUSY after 5 minutes; expect A/A flags' : ', quiet for 30 s'}`);
};

/** ---- the parent: build the ref, run the rounds, judge against the A/A ---- */
const ref = flag('--compare');
if (ref === undefined) {
  console.error('usage: node bench/ssr-scan.mjs --compare <git ref> [--rounds 10] [--only content,compile,components,article]');
  process.exit(2);
}
const rounds = Number(flag('--rounds') ?? 10);
const workloads = (flag('--only') ?? 'content,compile,components,article').split(',');

const head = `${root}packages/ssr/dist/vera/index.js`;
if (!existsSync(head)) throw new Error('bench/ssr-scan: build first — `npm run build` (benchmarks measure the built dist)');
const sha = execFileSync('git', ['rev-parse', '--short', ref], { cwd: root, encoding: 'utf8' }).trim();
const base = `${cache}ssr-${sha}/`;
if (!existsSync(`${base}built`)) {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(base, { recursive: true });
  const archive = execFileSync('git', ['archive', sha, 'packages/ssr'], { cwd: root });
  spawnSync('tar', ['-x', '-C', base], { input: archive });
  if (existsSync(`${base}packages/ssr/tsconfig.json`)) execFileSync('npx', ['tsc', '-p', `${base}packages/ssr/tsconfig.json`], { cwd: root, stdio: 'inherit' });
  /** Written last, so an interrupted build is redone rather than measured. */
  writeFileSync(`${base}built`, sha);
}
const baseEntry = existsSync(`${base}packages/ssr/dist/vera/index.js`) ? `${base}packages/ssr/dist/vera/index.js` : `${base}packages/ssr/src/vera/index.js`;
/**
 * HEAD's dist, copied TWICE beside the ref — once as HEAD, once as the A/A — so all three load from paths of the same
 * depth and shape: a variant's path is otherwise part of what the race measures.
 */
const copyHead = (name) => {
  const at = `${cache}${name}/`;
  rmSync(at, { recursive: true, force: true });
  cpSync(`${root}packages/ssr/dist`, `${at}packages/ssr/dist`, { recursive: true });
  return `${at}packages/ssr/dist/vera/index.js`;
};
const variants = { [sha]: baseEntry, HEAD: copyHead('ssr-head'), 'A/A': copyHead('ssr-head-copy') };
/** After everything this run wrote — the ref's build, the two copies — and before the first timed process. */
quiet();

let seed = 20261001;
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

console.log(`ssr-scan: ${sha} vs HEAD, ${rounds} rounds, A/A beside them\n`);
console.log('workload    measure   ' + `${sha}`.padStart(10) + '      HEAD   change   HEAD wins   A/A gap');
for (const workload of workloads) {
  const runs = Object.fromEntries(Object.keys(variants).map((v) => [v, { cold: [], steady: [] }]));
  for (let r = 0; r < rounds; r++)
    for (const name of shuffle(Object.keys(variants))) {
      const out = execFileSync(process.execPath, ['--conditions', 'development', fileURLToPath(import.meta.url), '--child', variants[name], workload], { encoding: 'utf8' });
      const [cold, steady] = JSON.parse(out.trim().split('\n').pop());
      runs[name].cold.push(cold);
      runs[name].steady.push(steady);
    }
  for (const measure of ['cold', 'steady']) {
    const a = median(runs[sha][measure]);
    const b = median(runs.HEAD[measure]);
    const c = median(runs['A/A'][measure]);
    const wins = runs.HEAD[measure].filter((x, i) => x < runs[sha][measure][i]).length;
    const gap = (Math.abs(b - c) / c) * 100;
    const unit = measure === 'cold' ? 'ms total' : 'ms/call';
    console.log(
      `${workload.padEnd(11)} ${measure.padEnd(7)} ${a.toFixed(4).padStart(10)} ${b.toFixed(4).padStart(9)} ${(((b / a) - 1) * 100).toFixed(1).padStart(6)}%   ${String(wins).padStart(4)}/${rounds}   ${gap.toFixed(1)}%  (${unit})` +
        (gap > 2 ? '   A/A PAST 2% — the machine was busy; re-run after it settles' : '')
    );
  }
}
