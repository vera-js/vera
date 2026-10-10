/**
 * **One failed directive import is ONE report** (code-system phase 4b, vera-5a, 2026-10-09). It was two: the loader's
 * `console.error` (the URL, the error) and the engine's `loader-failed` rejection (the directive, its elements) — each
 * with half the facts. Now the loader prints nothing and rejects with `Error(src, { cause })`; the engine reports once,
 * asking the loader's `url` for the address (never parsing a message) and forwarding the rejection beside the line —
 * so every build's line carries an Error named by the URL, the import's own error as its cause.
 * And a caller of `directiveLoader` with NO engine gets that same rejection and nothing printed: the loader's silence
 * is not silence for them — their catch (or the platform's unhandled-rejection report) is the channel.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text',
  'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { wire } = await load('core');
const { directiveLoader } = await load('autoloader');
const loader = directiveLoader(import.meta.url, 'fixtures/directive-modules');
const { wireDirectives, interactions, settled, rejections, directives } = await load('directives');
/** Through CORE's wire with `directives` — its connector adopts core's registry, so the engine reads the loader there
 *  in production too (a production directives bundle inlines its own core; this is how a page makes them one). */
wire([directives, loader]);
wireDirectives(interactions);

/** Every console line printed while `run` goes, as [method, args]. */
const capture = async (run) => {
  const said = [];
  const { warn, error } = console;
  console.warn = (...args) => said.push(['warn', args]);
  console.error = (...args) => said.push(['error', args]);
  try {
    await run();
  } finally {
    Object.assign(console, { warn, error });
  }
  return said;
};

test('through the engine: exactly one line, naming the address, the Error beside it — every build', async () => {
  const src = loader.url('missing-module');
  const said = await capture(async () => {
    const host = document.createElement('div');
    host.innerHTML = '<p data-vd-missing-module>x</p>';
    document.body.append(host);
    await settled();
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  assert.ok(rejections().some((one) => one.code === 'loader-failed'), 'CONTROL: the import failed and was recorded');
  assert.equal(said.length, 1, `one report, not two: ${JSON.stringify(said.map(([m, a]) => [m, a.map(String)]))}`);
  const [, args] = said[0];
  assert.equal(args[0], '%s', 'the line is an argument, never the format');
  assert.ok(String(args[1]).endsWith(isProduction ? '/e/loader-failed' : '(loader-failed)'), String(args[1]));
  if (!isProduction) assert.ok(String(args[1]).includes(src), `development's sentence names the address: ${args[1]}`);
  const forwarded = args.at(-1);
  assert.ok(forwarded instanceof Error && forwarded.message === src, 'the rejection, named by the address, in every build');
  assert.ok(forwarded.cause, "and the import's own error as its cause");
});

test('a direct caller, no engine: the rejection carries the address and the cause, and nothing is printed', async () => {
  const direct = directiveLoader(import.meta.url, 'fixtures/directive-modules');
  let caught;
  const said = await capture(async () => {
    caught = await direct('also-missing').catch((error) => error);
  });
  assert.deepEqual(said, [], 'the loader is silent — its caller reports');
  assert.ok(caught instanceof Error, 'CONTROL: it rejected');
  assert.equal(caught.message, direct.url('also-missing'), 'the message is the address');
  assert.equal(caught.cause?.code, 'ERR_MODULE_NOT_FOUND', "the cause is the import's own error");
});
