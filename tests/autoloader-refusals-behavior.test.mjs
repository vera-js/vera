/**
 * **The loaders' URL refusals, pinned by BEHAVIOR in every build** (vera-5a, code-system phase 3, 2026-10-09) — so a
 * byte-trim can never take the guard along with its message. A hostile `data-autoload-dir` (or an alias that leaves the
 * base) makes no request at all: the autoloader says `loader-url-refused` and dispatches no load error (an attempted
 * import of `//evil.test` would fail, and that failure is a `vera:autoload-error`); `directiveLoader.load` returns
 * `false` — no import promise exists. The refused URL is the line's subject, so production still names it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
for (const k of ['HTMLElement', 'customElements', 'document', 'MutationObserver', 'CustomEvent', 'Element']) globalThis[k] = dom.window[k];
const origQSA = dom.window.Element.prototype.querySelectorAll;
dom.window.Element.prototype.querySelectorAll = function (sel) {
  if (sel === ':not(:defined)') return [...origQSA.call(this, '*')].filter((el) => el.localName.includes('-') && !dom.window.customElements.get(el.localName));
  return origQSA.call(this, sel);
};
const rootDir = new URL('./fixtures/autoloader/entry.js', import.meta.url).href;
const { autoloader, directiveLoader } = await load('autoloader');
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
/** The line IS the refusal — its code ends it (a line that merely quotes one, mislabeled as another code, does not count). */
const refusedLine = (line) => line.endsWith(isProduction ? '/e/loader-url-refused' : '(loader-url-refused)');

test('autoloader: a hostile data-autoload-dir is refused by code and NOTHING is requested — every build', async () => {
  const said = [];
  const error = console.error;
  console.error = (...args) => said.push(String(args[0]));
  const app = document.createElement('div');
  /** The autoloader scans only a container that opts in — without this the CONTROL below would pass on a silence. */
  app.setAttribute('data-autoload', '');
  app.innerHTML = '<evil-widget data-autoload-dir="//evil.test"></evil-widget>';
  document.body.append(app);
  const failures = [];
  app.addEventListener('vera:autoload-error', (event) => failures.push(event.detail.src));
  try {
    autoloader(rootDir, 'components')(app);
    await tick();
  } finally {
    console.error = error;
  }
  assert.deepEqual(failures, [], 'no load was attempted, so none failed');
  const lines = said.filter(refusedLine);
  assert.equal(lines.length, 1, said.join(' | '));
  assert.ok(lines[0].includes('evil.test'), 'the refused URL is named in every build (it is the subject)');
  if (!isProduction) assert.match(lines[0], /it resolves outside[\s\S]*\(loader-url-refused\)$/);
});

test('directiveLoader: an alias leaving the base is refused — the load returns false, no import exists — every build', () => {
  const said = [];
  const error = console.error;
  console.error = (...args) => said.push(String(args[0]));
  let result;
  try {
    /** The loader IS its load function (it also carries `url` and the `'loader'` insert fields). */
    result = directiveLoader(rootDir, 'directives', { alias: { escape: 'https://evil.test/x.js' } })('escape');
  } finally {
    console.error = error;
  }
  assert.equal(result, false, 'not a promise: nothing was imported');
  const lines = said.filter(refusedLine);
  assert.equal(lines.length, 1, said.join(' | '));
  assert.ok(lines[0].includes('evil.test'), 'named in every build');
});
