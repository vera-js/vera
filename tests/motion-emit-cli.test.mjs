/**
 * `vera-motion-emit` — the first-frame door for every toolchain that is not vera-SSR and not
 * PHP: static HTML in, markers + the motion sheet out, through the REAL pipeline. The test runs
 * the actual bin as a subprocess on a temp page and asserts the emitted file hydrates-ready:
 * markers present, sheet present, the reduced-motion and scripting neutralisers riding along,
 * and a second run CONVERGING rather than accumulating.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PAGE = `<!doctype html><html><head><title>t</title></head><body>
<div id="a" data-vd-motion="fade-up">hello</div>
<div id="b" data-vd-motion="{ keyframes: { opacity: '0% 0.15, 100% 0.85' } }">scrubs</div>
<div id="c" data-vd-motion="{ tick: 'draw', scroll: '100%, 0%' }">js-first</div>
</body></html>`;

test('the CLI emits first-frame CSS into static HTML through the real pipeline', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vera-emit-'));
  const file = join(dir, 'page.html');
  writeFileSync(file, PAGE);

  const bin = new URL('../packages/directives/bin/motion-emit.mjs', import.meta.url).pathname;
  const out = execFileSync(process.execPath, ['--conditions', 'development', bin, file], {
    encoding: 'utf8',
    cwd: new URL('..', import.meta.url).pathname,
  });
  assert.match(out, /2 element\(s\) across 1 page\(s\)/, 'the preset and the scrub emitted; the tick is honestly JS-first');

  const html = readFileSync(file, 'utf8');
  assert.match(html, /id="a" data-vd-motion="fade-up" data-vm-motion="[0-9a-f]{8}"/, 'the preset is marked');
  assert.match(html, /style data-vm-sheet/, 'the sheet landed in head');
  assert.match(html, /@property --vm-p/, 'typed and defaulted — frame 0 with no JS');
  assert.match(html, /prefers-reduced-motion: reduce/, 'the reduced neutraliser rides');
  assert.match(html, /scripting: none/, 'and the no-JS guard');
  assert.ok(!html.includes('id="c" data-vd-motion="{ tick') || !/id="c"[^>]*data-vm-motion=/.test(html),
    'the tick element is unmarked — its first frame is JavaScript by definition');

  /** Idempotence with the CONTROL built in: the first run changed the file (asserted above), so
   *  a byte-identical second run is convergence, not a pass that never ran. */
  execFileSync(process.execPath, ['--conditions', 'development', bin, file], {
    encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname,
  });
  assert.equal(readFileSync(file, 'utf8'), html, 'a second run converges byte-for-byte');
});
