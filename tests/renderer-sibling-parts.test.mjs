/**
 * Regression: `ChildPart._clear()` used to walk off the end of the child list and throw
 * `Cannot read properties of null (reading 'nextSibling')`.
 *
 * `TextPart` upgrades to a `ChildPart` on its first non-primitive value. It used to borrow
 * `this._text.nextSibling` as its exclusive end — a node owned by the NEXT part, which that part
 * removes when it upgrades and clears its own text. The stale boundary then made `_clear()` walk
 * past the end of the parent. The upgrade now inserts its own end marker, so a part owns both
 * anchors and `_end === null` means only "root part".
 *
 * Reduced from a real app; the trigger needs several sibling parts in one parent that each toggle
 * between a template and '', with a keyed list among them. Smaller shapes do not reproduce it,
 * which is why the fixture is a small app rather than a single template.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const { transformJsx } = await import('../packages/jsx/src/transform.js');
const source = readFileSync(new URL('./fixtures/sibling-child-parts.jsx', import.meta.url), 'utf8');
const compiled = new URL('./fixtures/.sibling-child-parts.compiled.mjs', import.meta.url);
writeFileSync(compiled, transformJsx(source, 'sibling-child-parts.jsx'));

const dom = new JSDOM('<!doctype html><body><tarot-app></tarot-app></body>', { pretendToBeVisual: true });
for (const k of ['window', 'document', 'customElements', 'HTMLElement', 'Node', 'Element', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(() => setTimeout(r, 0)));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

try {
  await import(compiled.href);
  const app = dom.window.document.querySelector('tarot-app');
  await frame(); await frame();
  const btn = (text) => [...app.querySelectorAll('button')].find((b) => b.textContent.includes(text));

  btn('Draw the spread').click(); await frame(); await frame();
  check('one-card spread deals', app.querySelectorAll('.card-slot').length === 1);
  btn('Turn every card').click(); await frame(); await frame();

  /* switching spread empties the table, then a bigger draw refills it: this is the sequence that
     used to leave a part holding a detached boundary */
  btn('Celtic').click(); await frame(); await frame();
  check('switching spread clears the table', app.querySelectorAll('.card-slot').length === 0);

  btn('Draw the spread').click(); await frame(); await frame();
  const dealt = app.querySelectorAll('.card-slot').length;
  check('ten-card spread deals all ten after a clear', dealt === 10, `dealt ${dealt}`);

  btn('Turn every card').click(); await frame(); await frame();
  check('every card turns', app.querySelectorAll('.card.is-up').length === 10);
  check('one reading line per card', app.querySelectorAll('.line').length === 10);
} catch (error) {
  fail++;
  console.log('FAIL: render threw —', error.message);
} finally {
  try { unlinkSync(compiled); } catch {}
}

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
