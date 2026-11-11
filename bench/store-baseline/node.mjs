/**
 * Node driver for the store baseline: ONE bundle per process (a fresh process per variant: shared call sites would go
 * polymorphic across variants). Usage: `node [--expose-gc] node.mjs <bundle.min.js> <rows|alloc|mem>` → one JSON line.
 * The bundle is imported as the module it is; the DOM globals core touches at load (customElements) come from jsdom.
 */
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { run, allocation, memoryPerHook } from './rows.mjs';
import { runHooks, hookMemory } from './hook-rows.mjs';

/** `rows` takes a reps file (calibrated once on the reference, the same for every arm); `calibrate` makes one. */
const [bundle, mode = 'rows', repsFile] = process.argv.slice(2);
const reps = repsFile ? JSON.parse(readFileSync(repsFile, 'utf8')) : undefined;
const dom = new JSDOM('<!doctype html><body></body>');
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];
const core = await import(pathToFileURL(bundle).href);
const sha = createHash('sha256').update(readFileSync(bundle)).digest('hex').slice(0, 12);
const kind = /\.min\.js$/.test(bundle) ? 'production' : 'development';
const result =
  mode === 'alloc' ? allocation(core)
  : mode === 'mem' ? memoryPerHook(core)
  : mode === 'hooks' ? runHooks(core, () => performance.now(), reps)
  : mode === 'hookcal' ? Object.fromEntries(Object.entries(runHooks(core, () => performance.now()).rows).map(([k, v]) => [k, v.reps]))
  : mode === 'hookmem' ? hookMemory(core)
  : mode === 'calibrate' ? Object.fromEntries(Object.entries(run(core, () => performance.now()).rows).map(([k, v]) => [k, v.reps]))
  : run(core, () => performance.now(), reps);
process.stdout.write(JSON.stringify({ bundle, sha, kind, mode, result }) + '\n');
dom.window.close();
