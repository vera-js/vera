/**
 * Migrated from the audit-session verification suites (scratchpad, 2026-08-20). Tests BUILT
 * artifacts, development AND production (see ./dist.mjs), so build defects fail here too. Plain pass/fail scripts under
 * node --test: a nonzero exit marks the file failed.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<div id="app" autoloader></div>', { url: 'http://localhost/' });
const { window } = dom;
globalThis.HTMLElement = window.HTMLElement;
globalThis.customElements = window.customElements;
globalThis.document = window.document;

const rootDir = new URL('./fixtures/autoloader/entry.js', import.meta.url).href;
const { initAutoloader } = await load('autoloader');
/** jsdom's selector engine lacks :defined — emulate exactly that one selector. */
const origQSA = window.Element.prototype.querySelectorAll;
window.Element.prototype.querySelectorAll = function (sel) {
  if (sel === ':not(:defined)') {
    return [...origQSA.call(this, '*')].filter(
      (el) => el.localName.includes('-') && !window.customElements.get(el.localName)
    );
  }
  return origQSA.call(this, sel);
};
const tick = () => new Promise((r) => setTimeout(r, 40));
let pass = 0, fail = 0;
const check = (n, c) => { c ? pass++ : (fail++, console.log('FAIL:', n)); };
const errs = [];
const oe = console.error; console.error = (...a) => errs.push(a.join(' '));

const discover = initAutoloader(rootDir, 'components');
const app = window.document.getElementById('app');

// 1. plain load works, element upgrades
app.innerHTML = '<probe-widget></probe-widget>';
discover(app); await tick();
check('component loads and defines', globalThis.__loads === 1 && !!customElements.get('probe-widget'));

// 2. repeated discover does NOT re-attempt (memo)
discover(app); discover(app); await tick();
check('no re-attempts for defined tag', globalThis.__loads === 1);

// 3. missing file: attempted once, not per render
app.innerHTML += '<ghost-widget></ghost-widget>';
discover(app); await tick();
const errsAfterFirst = errs.length;
discover(app); discover(app); await tick();
check('404 attempted once, then memoized', errsAfterFirst >= 1 && errs.length === errsAfterFirst);

// 4. autoload-dir override within base works
app.innerHTML += '<alt-widget autoload-dir="alt"></alt-widget>';
discover(app); await tick();
check('autoload-dir override loads from alt/', !!customElements.get('alt-widget'));

// 5. standard HTML dir attribute is IGNORED (i18n page must not break)
app.innerHTML += '<probe-widget dir="rtl"></probe-widget>';
const errsBefore = errs.length;
discover(app); await tick();
check('dir="rtl" no longer redirects loading', errs.length === errsBefore);

// 6. out-of-base values are refused, not fetched
for (const bad of ['https://example.invalid/x', '//example.invalid/x', '../../outside']) {
  app.innerHTML += `<esc-widget autoload-dir="${bad}"></esc-widget>`;
}
errs.length = 0;
discover(app); await tick();
const refusals = errs.filter((m) => m.includes('refused'));
check('out-of-base autoload-dir refused (3 variants)', refusals.length >= 1 && errs.every((m) => m.includes('refused') || m.includes('Failed')));
check('at least the absolute+relative escapes refused', refusals.length >= 2);

// 7. missing rootDir throws at init, not per element
let threw = false;
try { initAutoloader(''); } catch { threw = true; }
check('missing rootDir throws at init', threw);

// 8. components beside the entry file — the documented call with componentsDir omitted
//
// The default was `/`, which built `//tag.js`: protocol-relative, so `new URL` read the tag as a
// HOST. `initAutoloader(import.meta.url)` refused every component it was asked for, and so did
// `autoload-dir="/"`. Asserted on the URL rather than on a successful load, so the check does not
// depend on a fixture existing beside the entry.
{
  for (const [label, dir, attr] of [
    ['componentsDir omitted', undefined, ''],
    ['componentsDir "/"', '/', ''],
    ['componentsDir "components/"', 'components/', ''],
    ['autoload-dir="/"', 'components', ' autoload-dir="/"'],
  ]) {
    errs.length = 0;
    const tag = `beside-${label.replace(/\W+/g, '')}`.toLowerCase();
    app.innerHTML = `<${tag}${attr}></${tag}>`;
    initAutoloader(rootDir, dir)(app);
    await tick();
    const message = errs.join(' ');
    const expected = dir === 'components/' ? `/components/${tag}.js` : `/autoloader/${tag}.js`;
    check(`${label}: resolves inside the entry directory`,
      !message.includes('refused') && message.includes(expected));
  }
}

// 9. `resolve` replaces the URL shape without loosening the bound
{
  errs.length = 0;
  app.innerHTML = '<nested-widget></nested-widget>';
  initAutoloader(rootDir, 'components', { resolve: (tag, dir) => `${dir}/${tag}/${tag}.js` })(app);
  await tick();
  check('resolve builds the URL', errs.join(' ').includes('/components/nested-widget/nested-widget.js'));

  for (const [label, resolveFn] of [
    ['upward traversal', (tag) => `../../../evil/${tag}.js`],
    ['absolute URL', (tag) => `https://example.invalid/${tag}.js`],
  ]) {
    errs.length = 0;
    const tag = `res-${label.replace(/\W+/g, '')}`.toLowerCase();
    app.innerHTML = `<${tag}></${tag}>`;
    initAutoloader(rootDir, 'components', { resolve: resolveFn })(app);
    await tick();
    check(`resolve cannot escape the base: ${label}`, errs.join(' ').includes('refused'));
  }
}

console.error = oe;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
