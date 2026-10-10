/**
 * **`unknown-option` — one fact, one text, six modules** (code-system phase 4b, vera-5a, 2026-10-09). autoloader(),
 * directiveLoader(), router() and the directives packs remote(), sensors(), motion() each said "`x` is not an option"
 * in words of their own, under three codes and three inline strings. Now one SHARED text: the module is the line's
 * subject and the option list its own, and the sentence is the same everywhere.
 *
 * Five warn in development only. motion()'s check stays EVERY-BUILD (it was): it hands reject() the shared text in
 * development, so production still records the rejection and prints its code — `rejections()` is what an inspector
 * reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { printed } from './console-args.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text',
  'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { autoloader, directiveLoader } = await load('autoloader');
const { router } = await load('router');
const { wireDirectives, remote, sensors, motion, rejections } = await load('directives');

const said = [];
const warn = console.warn;
console.warn = (...args) => said.push(printed(args).map(String).join(' '));
try {
  autoloader(import.meta.url, 'components', { bogus: 1 });
  directiveLoader(import.meta.url, 'directives', { bogus: 1 });
  router({ bogus: 1 });
  wireDirectives([remote({ bogus: 1 }), sensors({ bogus: 1 }), motion({ bogus: 1 })]);
} finally {
  console.warn = warn;
}
const lines = said.filter((line) => line.includes('unknown-option'));
const SENTENCE = '`bogus` is not an option, so it was ignored.';

test('development: all six say the one sentence, each naming itself, each with its own list, by code', { skip: isProduction && 'production: motion() only, below' }, () => {
  const subjects = ['autoloader: options', 'directiveLoader: options', 'router: router()', 'directives: remote()', 'directives: sensors()', 'directives: motion()'];
  for (const subject of subjects) {
    const line = lines.find((one) => one.startsWith(`[vera] ${subject} — `));
    assert.ok(line, `${subject} said it: ${lines.join(' | ')}`);
    assert.ok(line.includes(` — ${SENTENCE} The options are `), `the one sentence: ${line}`);
    assert.ok(line.endsWith('(unknown-option)'), line);
  }
  assert.equal(lines.length, 6, lines.join(' | '));
});

test("production: motion()'s check still records and prints its code; the five development-only ones are silent", { skip: !isProduction && 'development: above' }, () => {
  assert.ok(rejections().some((one) => one.code === 'unknown-option'), 'the rejection is recorded');
  assert.deepEqual(lines, ['[vera] directives: motion() — https://verajs.dev/e/unknown-option'], lines.join(' | '));
});
