/**
 * **Motion's sentences reach the reader by every route** (code-system phase 4a, vera-5a's seam conditions, 2026-10-09).
 * Motion's prose lives in `@verajs/motion`'s own table now; the directives motion pack hands that table to the engine
 * once (`seams.prose`, development only), and the engine's `reject()` reads it. One code per route that carries a
 * motion code into the engine — so dropping the registration turns EVERY row red, not just one:
 *   A  the motion connector's page-problem reporter       `wireFunctions({ bad: 42 })` after `wireDirectives([motion])`
 *   B  an extension's reporter, with no motion connector   the same, after `wireDirectives([paint])` alone
 *   C  the parse refusals the directive forwards           an attribute whose `keyframes` is not an object
 *   D  the sequence tick's own rejecter                     the image sequence on a non-canvas
 * (The region callback carries only the pack's own codes, which live in directives' table.)
 * And `@verajs/motion` ON ITS OWN, unwired — the embedder this table was moved for — prints the sentence from ITS OWN
 * development bundle, and the bare code with its arguments in production. Each scenario runs in its own process: the
 * engine and motion's reporter are module state.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const SCENARIO = process.env.VERA_MOTION_ROUTE;

if (SCENARIO) {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const k of ['window', 'document', 'HTMLElement', 'HTMLCanvasElement', 'customElements', 'Node', 'Element',
    'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
    'MutationObserver', 'CSSStyleSheet', 'getComputedStyle']) globalThis[k] = dom.window[k];
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
  globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
  const said = [];
  console.warn = (...args) => said.push(args.map(String).join(' '));
  const report = (rejected) => process.stdout.write(JSON.stringify({ said, rejected }));
  if (SCENARIO === 'standalone') {
    const { pageProblem } = await load('motion/internal');
    pageProblem('motion-function-not-function', ['bad', 'number']);
    report([]);
  } else {
    const { wireDirectives, motion, paint, sequence, wireFunctions, settled, rejections } = await load('directives');
    /** `duplicate`: motion's table registered twice (motion AND paint both register it), then a third-party connector
     *  offering another text for one of its codes and for one of the engine's own. */
    const rewording = (seams) => seams.prose?.({ 'motion-function-not-function': () => ['reworded'], 'core-protocol': () => ['reworded'] });
    wireDirectives(SCENARIO === 'B' ? [paint] : SCENARIO === 'D' ? [motion, sequence] : SCENARIO === 'duplicate' ? [motion, paint, rewording] : [motion]);
    if (SCENARIO === 'A' || SCENARIO === 'B' || SCENARIO === 'duplicate') wireFunctions({ bad: 42 });
    else {
      const host = document.createElement('div');
      host.innerHTML = SCENARIO === 'C'
        ? '<div data-vd-motion="{ keyframes: 3 }">x</div>'
        : `<div data-vd-motion="{ function: 'sequence', scroll: '100%, 0%', frame-url: '/seq/', frame-count: 10 }">x</div>`;
      document.body.append(host);
      await settled();
      for (let i = 0; i < 2; i++) await new Promise((resolve) => dom.window.requestAnimationFrame(resolve));
    }
    report(rejections().map(({ code, message }) => ({ code, message })));
  }
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_MOTION_ROUTE: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  /** [route, code, a fragment of motion's sentence for it] */
  const ROUTES = [
    ['A', 'motion-function-not-function', "'bad' is number, not a function"],
    ['B', 'motion-function-not-function', "'bad' is number, not a function"],
    ['C', 'motion-keyframes-not-object', 'keyframes takes an object of properties'],
    ['D', 'motion-sequence-canvas', 'frame needs a <canvas> element'],
  ];
  for (const [route, code, fragment] of ROUTES)
    test(`route ${route}: ${code} reaches reject() and reads motion's own sentence`, () => {
      const { said, rejected } = run(route);
      const entry = rejected.find((one) => one.code === code);
      assert.ok(entry, `CONTROL: the refusal was recorded — ${JSON.stringify(rejected)}`);
      const line = said.find((one) => one.includes(code));
      assert.ok(line, `and printed — ${said.join(' | ')}`);
      if (isProduction) return assert.ok(line.endsWith(`https://verajs.dev/e/${code}`), line);
      assert.ok(entry.message.includes(fragment), `the registry carries motion's sentence: ${entry.message}`);
      assert.ok(line.includes(fragment) && line.endsWith(`(${code})`), `the console line too: ${line}`);
    });

  test('the prose seam merges and never replaces: the first text wins, a conflict is said once each, the same table twice is silent', () => {
    const { said, rejected } = run('duplicate');
    const entry = rejected.find((one) => one.code === 'motion-function-not-function');
    assert.ok(entry, 'CONTROL: the refusal was recorded');
    const conflicts = said.filter((line) => line.includes('prose-duplicate'));
    if (isProduction) return assert.deepEqual(conflicts, [], 'production has no seam at all');
    assert.ok(entry.message.includes("'bad' is number, not a function"), `motion's text kept, not the third party's: ${entry.message}`);
    assert.equal(conflicts.length, 2, `one line per conflicting code — and none for motion's table registered twice: ${conflicts.join(' | ')}`);
    assert.ok(conflicts.some((line) => line.includes('"core-protocol"')) && conflicts.some((line) => line.includes('"motion-function-not-function"')), conflicts.join(' | '));
  });

  test('@verajs/motion on its own, unwired: its own bundle says the sentence (development) or the bare code (production)', () => {
    const { said } = run('standalone');
    assert.equal(said.length, 1, said.join(' | '));
    if (isProduction) assert.equal(said[0], '[vera] motion-function-not-function: the page (bad, number)');
    else assert.match(said[0], /^\[vera\] motion: the page — wireFunctions: 'bad' is number, not a function[\s\S]*\(motion-function-not-function\)$/);
  });
}
