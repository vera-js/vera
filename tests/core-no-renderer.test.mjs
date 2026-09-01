/**
 * **The blank page, and the one message that has to survive minification.**
 *
 * Core ships no renderer of its own, so a component that renders with nothing wired produces an
 * empty page. Three separate mistakes end there — `wire` never called, wired with an import name
 * that resolved to nothing, or handed something that is not a module — and until now every one of
 * them was **completely silent in production**: no warning here, none from `wire`, nothing anywhere.
 *
 * That matters because **buildless is a first-class mode**. Someone pasting `vera.min.js` into
 * CodePen from a CDN never runs a development build, so a `__DEV__`-only diagnostic is invisible to
 * exactly the person most likely to have forgotten the wiring.
 *
 * Runs in its own process, because the warning fires once per process and every other suite wires a
 * renderer into the shared module instance before this could observe it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { isProduction } from './dist.mjs';

const script = (coreSpecifier) => `
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<body></body>', { pretendToBeVisual: true });
for (const k of ['document','HTMLElement','Node','customElements','requestAnimationFrame','cancelAnimationFrame','Element','DocumentFragment','Text','Comment','CSSStyleSheet'])
  globalThis[k] = dom.window[k];
const core = await import(${JSON.stringify(coreSpecifier)});
const said = [];
console.warn = (...a) => said.push(a.join(' '));
/** Four components, nothing wired. */
for (let i = 0; i < 4; i++) {
  customElements.define('x-bare-' + i, class extends HTMLElement {
    connectedCallback() { core.init(this, { mode: 'open' }); core.render(() => core.html\`<p>x</p>\`); }
  });
  dom.window.document.body.appendChild(dom.window.document.createElement('x-bare-' + i));
}
await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
process.stdout.write(JSON.stringify(said));
`;

const run = () => {
  /** Inside the repo, so the probe can resolve `jsdom` — a system temp dir cannot. */
  const dir = mkdtempSync(new URL('./.nowire-', import.meta.url).pathname);
  try {
    const core = new URL(
      `../packages/core/dist/${isProduction ? 'vera.min.js' : 'development/vera.js'}`,
      import.meta.url
    ).href;
    const file = join(dir, 'probe.mjs');
    writeFileSync(file, script(core));
    const out = execFileSync(process.execPath, [file], {
      encoding: 'utf8',
      cwd: new URL('..', import.meta.url).pathname,
    });
    return JSON.parse(out);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('rendering with no renderer wired says so, in every build', () => {
  const said = run();
  assert.equal(said.length, 1, `warned ${said.length} times; expected exactly once per process`);
  assert.match(said[0], /^\[vera\]/, 'carries the framework prefix');
  assert.match(said[0], /renderer/, 'and names what is missing');
  if (!isProduction)
    assert.match(said[0], /wire\(\[renderer\]\)/, 'development shows the two lines that fix it');
});
