/**
 * **`@vera-components/select`'s two diagnostics, by code** (2026-10-09). `defined-twice` — a second copy or
 * version of the library on one page keeps the first, said in EVERY build (production: the code-only line, which the
 * byte rule measured 65 B smaller than the old text); `select-duplicate` — option values must be distinct,
 * development only. Each scenario in its own process: the first defines `vera-select` as a foreign class, which leaves
 * no real one to give duplicate options to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const SCENARIO = process.env.VERA_UI_CODED;

if (SCENARIO) {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment',
    'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'KeyboardEvent', 'FormData', 'MutationObserver'])
    globalThis[key] = dom.window[key];
  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  const { wire } = await load('core');
  wire([(await load('renderer')).renderer, (await load('styles')).styles]);
  if (SCENARIO === 'twice') customElements.define('vera-select', class extends HTMLElement {});
  await load('vera-components/select');
  if (SCENARIO === 'duplicate') {
    const element = document.createElement('vera-select');
    document.body.append(element);
    element.options = [{ label: 'A', value: 'x' }, { label: 'B', value: 'x' }];
    await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
  }
  process.stdout.write(JSON.stringify(said));
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_UI_CODED: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test('defined-twice: another copy already defined the tag — said in every build, by code', () => {
    const lines = run('twice').filter((line) => line.includes('defined-twice'));
    assert.equal(lines.length, 1, lines.join(' | '));
    if (isProduction) assert.equal(lines[0], '[vera] select: <vera-select> — https://verajs.dev/e/defined-twice');
    else assert.match(lines[0], /^\[vera\] select: <vera-select> — is already defined by another copy or version of @vera-components\/select, so the first is kept\.[\s\S]*import @vera-components\/select\/elements[\s\S]*\(defined-twice\)$/);
  });

  test('select-duplicate: two options with one value are named in development', () => {
    const lines = run('duplicate').filter((line) => line.includes('select-duplicate'));
    if (isProduction) return assert.deepEqual(lines, []);
    assert.ok(lines.length >= 1, 'named');
    assert.match(lines[0], /^\[vera\] select: <vera-select> — options contain duplicate value "x"[\s\S]*\(select-duplicate\)$/);
  });
}
