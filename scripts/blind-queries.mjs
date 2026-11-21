/**
 * **The gate's "blind queries" step** (Brian approved, 2026-11-17): runs the SSR suites under the blind-query instrument
 * (`scripts/blind-query-instrument.mjs`) and fails on any blind query outside `ALLOWED` — a server suite asserting
 * absence against an empty document (its content inside a served shadow root, which jsdom parses as a plain
 * `<template>`). Found its class's first instance on its first run: `tests/ssr-raw-text.test.mjs`'s "no payload escapes"
 * checks had searched nothing. Its own positive control runs first and must record exactly the one planted query.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const instrument = join(root, 'scripts/blind-query-instrument.mjs');

/**
 * Blind queries a suite makes ON PURPOSE, each with its reason. Matched by test file and selector.
 */
const ALLOWED = [
  ['tests/ssr-directives.test.mjs', '[data-vd-state]', 'a first try: the next line falls back to the template content'],
  ['tests/ssr-directives.test.mjs', '[data-vd-list]', 'a first try: the region is then found in the template content'],
];

/** Runs `args` under the instrument; answers its records. */
const run = (args) => {
  const out = join(mkdtempSync(join(tmpdir(), 'vera-blind-')), 'records.jsonl');
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, BLIND_QUERIES_OUT: out, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${pathToFileURL(instrument).href}`.trim() },
    maxBuffer: 1 << 28,
  });
  if (result.status !== 0) {
    process.stdout.write(result.stdout.slice(-4000));
    process.stderr.write(result.stderr.slice(-4000));
    throw new Error(`blind queries: the run failed (status ${result.status}): ${args.join(' ')}`);
  }
  return existsSync(out) ? readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
};

const control = run(['tests/fixtures/blind-queries/control.mjs']);
if (control.length !== 1 || control[0].selector !== 'img')
  throw new Error(`blind queries: the CONTROL recorded ${JSON.stringify(control)}, not exactly the planted query — the instrument is broken`);

const suites = readdirSync(join(root, 'tests')).filter((name) => /^ssr-.*\.test\.mjs$/.test(name)).map((name) => `tests/${name}`);
const records = run(['--test', '--conditions', 'development', ...suites]);
const relative = (at) => at.replace(`${root}`, '').replace(/^\/+/, '');
const unexpected = records.filter(({ at, selector }) => !ALLOWED.some(([file, allowed]) => relative(at).startsWith(file) && selector === allowed));
const unique = [...new Set(unexpected.map(({ at, query, selector }) => `${relative(at)}  ${query}('${selector}')`))];
console.log(`blind queries: control recorded its one query; ${suites.length} SSR suites, ${records.length} records, ${unique.length} outside the allow-list`);
if (unique.length !== 0) {
  console.error(`a server suite queried where its content is not (a served shadow root parses as a <template>):\n  ${unique.join('\n  ')}\nQuery template content too, with a positive control first (CLAUDE.md).`);
  process.exit(1);
}
