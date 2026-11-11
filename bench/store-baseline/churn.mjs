/**
 * **Component churn micro**: a component with three effects over a shared store, appended and removed
 * N times per sample — element teardown is the path c1 changed, which the store rows never touch. ONE bundle per process;
 * the sample is ≥ 50 ms (reps fixed by the caller, or calibrated). Usage:
 *   node churn.mjs <bundle.min.js> [reps]   → one JSON line { median ms per rep, reps, sampleMs }
 */
import { JSDOM } from 'jsdom';
import { pathToFileURL } from 'node:url';

const [bundle, fixed] = process.argv.slice(2);
const dom = new JSDOM('<!doctype html><body></body>');
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'CSSStyleSheet'])
  globalThis[k] = dom.window[k];
const core = await import(pathToFileURL(bundle).href);
const { define, createStore, effect, flush } = core;
const shared = createStore({ a: 1, b: 2, c: 3 });
let sink = 0;
define('x-churn', () => {
  effect(() => { sink += shared.a; return () => { sink--; }; });
  effect(() => { sink += shared.b; }, { timing: 'layout' });
  effect(() => { sink += shared.c; });
  return undefined;
});
const host = document.body;
const N = 200;
const once = () => {
  const els = [];
  for (let i = 0; i < N; i++) { const el = document.createElement('x-churn'); host.append(el); els.push(el); }
  flush();
  for (let i = 0; i < N; i++) els[i].remove();
  flush();
};
for (let i = 0; i < 5; i++) once();
let reps = fixed ? Number(fixed) : 1;
if (!fixed) for (;;) { const t = performance.now(); for (let i = 0; i < reps; i++) once(); if (performance.now() - t >= 50) break; reps *= 2; }
const runs = [];
for (let p = 0; p < 9; p++) { const t = performance.now(); for (let i = 0; i < reps; i++) once(); runs.push(performance.now() - t); }
runs.sort((a, b) => a - b);
const sampleMs = runs[4];
process.stdout.write(JSON.stringify({ median: sampleMs / reps, reps, sampleMs, sink }) + '\n');
dom.window.close();
