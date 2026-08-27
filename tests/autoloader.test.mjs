/**
 * URL building, bounding, and the discovery model — against BUILT artifacts, development AND
 * production (see ./dist.mjs). Plain pass/fail script under node --test: a nonzero exit fails.
 *
 * jsdom has no `:defined`, so the one selector discovery rests on is emulated below. That makes
 * this suite authoritative about *what URL is fetched and whether it is allowed*, and not about
 * what gets found in the first place — `tests/browser/autoloader.test.js` owns that, on three
 * engines.
 */
import { load, isProduction } from './dist.mjs';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<body></body>', { url: 'http://localhost/' });
const { window } = dom;
for (const k of ['HTMLElement', 'customElements', 'document', 'MutationObserver', 'CustomEvent', 'Element'])
  globalThis[k] = window[k];

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

const rootDir = new URL('./fixtures/autoloader/entry.js', import.meta.url).href;
const { autoloader } = await load('autoloader');

const tick = () => new Promise((r) => setTimeout(r, 40));
let pass = 0, fail = 0;
const check = (n, c, extra = '') => { c ? pass++ : (fail++, console.log('FAIL:', n, extra)); };

const errs = [];
const oe = console.error;
console.error = (...a) => errs.push(a.join(' '));

/**
 * A fresh host per case, torn down after it. An autoloader keeps watching once attached — that is
 * the point of the observed model — so a host left behind would still be live when the next case
 * put markup in it.
 */
const hosts = [];
const host = (html = '') => {
  const element = window.document.createElement('div');
  element.setAttribute('autoloader', '');
  element.innerHTML = html;
  window.document.body.appendChild(element);
  hosts.push(element);
  return element;
};
/** Called at the end of each case; nothing may observe another case's markup. */
const clearHosts = () => {
  while (hosts.length) hosts.pop().remove();
  errs.length = 0;
};

// 1. a component loads and defines
{
  const app = host('<probe-widget></probe-widget>');
  autoloader(rootDir, 'components')(app);
  await tick();
  check('component loads and defines', globalThis.__loads === 1 && !!customElements.get('probe-widget'));
}

clearHosts();

// 2. an element that arrives LATER is still found — the render insert is no longer the only path
{
  const app = host();
  autoloader(rootDir, 'alt')(app);
  await tick();
  app.innerHTML = '<alt-widget></alt-widget>';
  await tick();
  check('an element inserted after attach is found', !!customElements.get('alt-widget'));
}

clearHosts();

// 3. a missing file is attempted once, however many times it appears
{
  errs.length = 0;
  const app = host('<ghost-widget></ghost-widget>');
  autoloader(rootDir, 'components')(app);
  await tick();
  const after = errs.filter((m) => m.includes('ghost-widget')).length;
  app.innerHTML += '<ghost-widget></ghost-widget><ghost-widget></ghost-widget>';
  await tick();
  check('404 attempted once, then memoized',
    after >= 1 && errs.filter((m) => m.includes('ghost-widget')).length === after);
}

clearHosts();

// 4. a failure is reported as a DOM event, so an app can render around it
{
  const app = host();
  autoloader(rootDir, 'components')(app);
  const seen = [];
  app.addEventListener('vera:autoload-error', (e) => seen.push(e.detail));
  app.innerHTML = '<absent-widget></absent-widget>';
  await tick();
  check('a failed load dispatches vera:autoload-error', seen.length === 1, JSON.stringify(seen.length));
  check('the event names the tag and the URL',
    seen[0]?.tag === 'absent-widget' && String(seen[0]?.src).includes('/components/absent-widget.js'));
  check('and carries the element, which is what retry() takes',
    seen[0]?.element === app.querySelector('absent-widget'));
}

clearHosts();

// 4b. `autoload()` with no argument scans every marked host on the page
//
// This used to happen by itself as the autoloader was created — once, so markup arriving later was
// never seen, and with two autoloaders on a page each adopting every host.
{
  errs.length = 0;
  const app = host('<swept-widget></swept-widget>');
  const autoload = autoloader(rootDir, 'alt');
  await tick();
  check('creating an autoloader touches nothing', errs.length === 0, errs.join(' '));
  autoload();
  await tick();
  /** Asserted on the attempt, so the case needs no fixture of its own. */
  check('autoload() finds a marked host it was never handed',
    errs.some((m) => m.includes('/alt/swept-widget.js')), errs.join(' '));
  void app;
}

clearHosts();

// 4c. url() is the URL it would fetch, and retry() takes the element that failed
{
  const autoload = autoloader(rootDir, 'components');
  check('url() builds the fetch URL', autoload.url('any-widget').endsWith('/components/any-widget.js'),
    autoload.url('any-widget'));
  check('url() honours a resolve option',
    autoloader(rootDir, 'c', { resolve: (t, d) => `${d}/${t}/${t}.js` }).url('x-y').endsWith('/c/x-y/x-y.js'));

  errs.length = 0;
  const app = host('<retried-widget></retried-widget>');
  const failing = autoloader(rootDir, 'missing-dir');
  failing(app);
  await tick();
  check('the first attempt failed', errs.some((m) => m.includes('retried-widget')));
  errs.length = 0;
  failing.retry(app.querySelector('retried-widget'));
  await tick();
  check('retry() attempts it again', errs.some((m) => m.includes('retried-widget')));
}

clearHosts();

// 5. the standard HTML dir attribute is IGNORED (an i18n page must not break)
{
  errs.length = 0;
  const app = host('<probe-widget dir="rtl"></probe-widget>');
  autoloader(rootDir, 'components')(app);
  await tick();
  check('dir="rtl" does not redirect loading', errs.length === 0, errs.join(' '));
}

clearHosts();

// 6. out-of-base values are refused, not fetched
{
  errs.length = 0;
  const app = host(
    ['https://example.invalid/x', '//example.invalid/x', '../../outside']
      .map((bad, i) => `<esc${i}-widget autoload-dir="${bad}"></esc${i}-widget>`)
      .join('')
  );
  autoloader(rootDir, 'components')(app);
  await tick();
  check('all three out-of-base escapes refused', errs.filter((m) => m.includes('refused')).length === 3,
    errs.join(' | '));
}

clearHosts();

// 7. a missing or relative rootDir throws at init, not per element
//
// A relative one used to reach `new URL` and surface the platform's own `Invalid base URL`, which
// names neither the argument nor the fix. Every component URL resolves against this value, so it
// has to be absolute — which is exactly why `import.meta.url` is the documented answer.
{
  for (const [label, value, expected] of [
    ['missing', '', /rootDir is required/],
    /**
     * The *message* is `__DEV__`-only — a production bundle carries neither the check nor the text,
     * so the platform's own `Invalid URL` surfaces instead. Both still throw, which is what
     * matters; only the help is a development cost.
     */
    ['relative path', './components/entry.js', isProduction ? /Invalid URL/ : /must be an absolute URL/],
    ['bare directory', 'components', isProduction ? /Invalid URL/ : /must be an absolute URL/],
  ]) {
    let message = '';
    try { autoloader(value); } catch (error) { message = String(error.message); }
    check(`a ${label} rootDir throws at init, naming the fix`, expected.test(message), message);
  }
}

clearHosts();

// 8. components beside the entry file — the documented call with componentsDir omitted
//
// The default was `/`, which built `//tag.js`: protocol-relative, so `new URL` read the tag as a
// HOST. `autoloader(import.meta.url)` refused every component it was asked for, and so did
// `autoload-dir="/"`. Asserted on the URL, so the check does not need a fixture beside the entry.
{
  for (const [label, dir, attr] of [
    ['componentsDir omitted', undefined, ''],
    ['componentsDir "/"', '/', ''],
    ['componentsDir "components/"', 'components/', ''],
    ['autoload-dir="/"', 'components', ' autoload-dir="/"'],
  ]) {
    errs.length = 0;
    const tag = `beside${label.replace(/\W+/g, '')}-widget`.toLowerCase();
    const app = host(`<${tag}${attr}></${tag}>`);
    autoloader(rootDir, dir)(app);
    await tick();
    const message = errs.join(' ');
    const expected = dir === 'components/' ? `/components/${tag}.js` : `/autoloader/${tag}.js`;
    check(`${label}: resolves inside the entry directory`,
      !message.includes('refused') && message.includes(expected), message);
  }
}

clearHosts();

// 9. `resolve` replaces the URL shape without loosening the bound
{
  errs.length = 0;
  const app = host('<nested-widget></nested-widget>');
  autoloader(rootDir, 'components', { resolve: (tag, dir) => `${dir}/${tag}/${tag}.js` })(app);
  await tick();
  check('resolve builds the URL', errs.join(' ').includes('/components/nested-widget/nested-widget.js'),
    errs.join(' '));

  for (const [label, resolveFn] of [
    ['upward traversal', (tag) => `../../../evil/${tag}.js`],
    ['absolute URL', (tag) => `https://example.invalid/${tag}.js`],
  ]) {
    errs.length = 0;
    const tag = `res${label.replace(/\W+/g, '')}-widget`.toLowerCase();
    const app2 = host(`<${tag}></${tag}>`);
    autoloader(rootDir, 'components', { resolve: resolveFn })(app2);
    await tick();
    check(`resolve cannot escape the base: ${label}`, errs.join(' ').includes('refused'), errs.join(' '));
  }
}

clearHosts();

// 10. one tag reached through two directories imports ONE module
//
// Both used to import, and the second module's `customElements.define` threw NotSupportedError —
// reported as a failed load for a component that had in fact loaded fine.
{
  errs.length = 0;
  const app = host('<probe-widget></probe-widget><probe-widget autoload-dir="alt"></probe-widget>');
  autoloader(rootDir, 'components')(app);
  await tick();
  check('a second directory for a defined tag is not fetched',
    !errs.some((m) => m.includes('probe-widget')), errs.join(' | '));
}

clearHosts();
/**
 * A module that imports cleanly and defines the WRONG tag. `whenDefined` never settles for the tag
 * that was asked for, so the `catch` never ran: no console line, no `vera:autoload-error`, and an
 * element left unupgraded for the life of the page. A blank space with a clean console, from a typo.
 */
{
  const app = host('<typo-widget></typo-widget>');
  const seen = [];
  app.addEventListener('vera:autoload-error', (event) => seen.push(event.detail.tag));
  autoloader(rootDir, 'components')(app);
  await tick();
  check('a module that defines the wrong tag is reported, not silent', seen.length === 1 && seen[0] === 'typo-widget',
    JSON.stringify(seen));
  check('and the message names the likely cause', errs.some((line) => /nothing defined <typo-widget>/.test(line)),
    errs.join(' | '));
  check('while the element stays unupgraded', !customElements.get('typo-widget'));
}

clearHosts();

console.error = oe;
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
