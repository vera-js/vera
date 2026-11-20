/**
 * **Every template has ONE hidden class** (2026-11-18). A field set on SOME templates only — `_text`, the child positions
 * inside an HTML `<title>`/`<textarea>`, added at first to the templates that had one — gave those templates their own
 * map, and every per-row read of a template in `update` then met two shapes: V8 counted +1.31% instructions per select
 * on a page holding a textarea row and a plain table. Any field of `Template` is initialized in its class, never added
 * conditionally on a production path. Asked of V8 itself (`%HaveSameMap`, in a child process with natives syntax), on
 * the build under test, with a control showing the question can answer "different".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { isProduction } from './dist.mjs';
import { fsPath } from '../scripts/fs-path.mjs';

const root = fsPath(new URL('..', import.meta.url));
/** The child imports by URL: a Windows path is not an import specifier (ERR_UNSUPPORTED_ESM_URL_SCHEME). */
const rootUrl = new URL('..', import.meta.url).href;
const script = `
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>');
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'HTMLTemplateElement']) globalThis[k] = dom.window[k];
const core = await import('${rootUrl}packages/core/dist/${isProduction ? 'vera.min.js' : 'development/vera.js'}');
const R = await import('${rootUrl}packages/renderer/dist/${isProduction ? 'vera-renderer.min.js' : 'development/vera-renderer.js'}');
core.wire([R.renderer]);
const getTemplate = core.inserts.$H[2];
const shapes = {
  textarea: (l) => core.html\`<tr><td><textarea>\${l}</textarea></td></tr>\`,
  title: (l) => core.html\`<title>\${l}</title>\`,
  style: (l) => core.html\`<style>\${l}</style>\`,
  plain: (l) => core.html\`<tr><td><a>\${l}</a></td></tr>\`,
};
const t = Object.fromEntries(Object.entries(shapes).map(([k, f]) => [k, getTemplate(f('x'))]));
const control = getTemplate(core.html\`<p>\${'y'}</p>\`);
control.zqExtra = 1;
process.stdout.write(JSON.stringify({
  textarea: %HaveSameMap(t.textarea, t.plain), title: %HaveSameMap(t.title, t.plain), style: %HaveSameMap(t.style, t.plain),
  control: %HaveSameMap(control, t.plain),
}));
`;

test('a textarea, title or style template has the same hidden class as a plain one (V8 %HaveSameMap)', () => {
  const out = JSON.parse(execFileSync(process.execPath, ['--allow-natives-syntax', '--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' }));
  assert.equal(out.control, false, 'CONTROL: a template given an extra field reads as a different map');
  assert.deepEqual({ textarea: out.textarea, title: out.title, style: out.style }, { textarea: true, title: true, style: true });
});
