import { expect } from '@esm-bundle/chai';
import { autoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';
import { until } from './until.js';
import { engineOf, ENGINE, ON } from './engine.js';

/**
 * The autoloader, in a real engine.
 *
 * Its whole discovery mechanism is `querySelectorAll(':not(:defined)')`, and jsdom has no
 * `:defined` at all — `tests/autoloader.test.mjs` monkey-patches the selector to emulate it. That
 * suite therefore tests the loading and bounding logic against a hand-written stand-in for the one
 * line that decides *what gets loaded at all*. This is where that line runs for real.
 */

const entry = new URL('./fixtures/autoloader/entry.js', import.meta.url).href;

/**
 * Waits for the thing being asserted, not for a duration. Loading a component means a real network
 * fetch and a module evaluation, and how long that takes depends on the machine and on how many
 * engines are running at once — this suite was written with a fixed 120 ms sleep and failed on
 * Firefox roughly half the time when all three browsers ran together.
 */

/**
 * **What the autoloader asked for**, read through its own `resolve` option (same URLs as the default): a row that says
 * nothing loaded reads `asked` at once, after the synchronous call that would have asked, instead of sleeping 300 ms
 * and reading `customElements.get`. A fixed sleep proved nothing about a load a busy machine delivers late, and two of
 * those tags (`skipped-widget`, `unscanned-widget`) have no module at all, so a wrong load would only have 404ed and
 * the row could not fail. Each row also asks for a control in the same call, so an empty answer is never a recorder
 * that saw nothing.
 */
const recorder = () => {
  const asked = [];
  return { asked, resolve: (tag, dir) => (asked.push(`${dir}/${tag}`), `${dir}/${tag}.js`) };
};

/** A macrotask: every mutation-observer delivery queued before it has run. Not a time. */
const task = () => new Promise((r) => setTimeout(r, 0));

const host = (html) => {
  const element = document.createElement('div');
  element.setAttribute('data-autoload', '');
  element.innerHTML = html;
  document.body.appendChild(element);
  return element;
};

/* ── what the selector actually matches ──────────────────────────────────────────────────────── */
/**
 * Load-bearing: the loop then filters on `localName.includes('-')` and `customElements.get(tag)`.
 * Whether those guards are redundant or are carrying the module depends entirely on this, and it
 * cannot be answered under an emulated selector.
 */
it(':not(:defined) matches un-upgraded custom elements only', () => {
  const element = host(`
    <div></div><span></span><madeupelement></madeupelement>
    <not-yet-defined></not-yet-defined>
    <probe-widget></probe-widget>`);
  const matched = [...element.querySelectorAll(':not(:defined)')].map((n) => n.localName);

  expect(matched, 'a dashless unknown tag is still :defined').to.not.include('madeupelement');
  expect(matched, 'built-ins are :defined').to.not.include('div');
  expect(matched).to.include('not-yet-defined');
  element.remove();
});

it('an element stops matching once its definition arrives', () => {
  const element = host('<late-widget></late-widget>');
  expect([...element.querySelectorAll(':not(:defined)')]).to.have.length(1);
  customElements.define('late-widget', class extends HTMLElement {});
  expect([...element.querySelectorAll(':not(:defined)')], 'defining it removes it from the set')
    .to.have.length(0);
  element.remove();
});

/* ── loading, end to end ─────────────────────────────────────────────────────────────────────── */
it('discovers an undefined element and defines it from its module', async () => {
  const element = host('<probe-widget></probe-widget>');
  autoloader(entry, 'components')(element);
  await until(() => customElements.get('probe-widget'), "() => customElements.get('probe-widget')", 4000);

  expect(customElements.get('probe-widget'), 'the definition arrived').to.be.a('function');
  expect(element.querySelector('probe-widget').textContent).to.equal('probe');
  element.remove();
});

it('data-autoload-dir moves one element to another directory inside the base', async () => {
  const element = host('<alt-widget data-autoload-dir="alt"></alt-widget>');
  autoloader(entry, 'components')(element);
  await until(() => customElements.get('alt-widget'), "() => customElements.get('alt-widget')", 4000);
  expect(customElements.get('alt-widget')).to.be.a('function');
  element.remove();
});

it('an element marked data-autoload-ignore is left alone', async () => {
  const { asked, resolve } = recorder();
  const element = host('<skipped-widget data-autoload-ignore></skipped-widget><ctl-ignore></ctl-ignore>');
  autoloader(entry, 'components', { resolve })(element);
  expect(asked, 'the same scan asked for the control and not for the ignored element').to.deep.equal(['components/ctl-ignore']);
  await until(() => customElements.get('ctl-ignore'), 'the control loaded', 4000);
  element.remove();
});

it('a host without the autoloader attribute is never watched', async () => {
  const { asked, resolve } = recorder();
  const autoload = autoloader(entry, 'components', { resolve });
  const element = document.createElement('div');
  element.innerHTML = '<unscanned-widget></unscanned-widget>';
  document.body.appendChild(element);
  autoload(element);
  expect(asked, 'not scanned').to.deep.equal([]);
  /** Not observed either: one observer serves every root, so the marked control's later record is delivered after the unmarked one's. */
  const marked = host();
  autoload(marked);
  element.append(document.createElement('unscanned-late'));
  marked.append(document.createElement('ctl-unscanned'));
  await task();
  expect(asked, 'only the control, in the marked host').to.deep.equal(['components/ctl-unscanned']);
  await until(() => customElements.get('ctl-unscanned'), 'the control loaded', 4000);
  element.remove();
  marked.remove();
});

/* ── the holes the rescan model could not close ──────────────────────────────────────────────── */
/**
 * Each of these was measured as MISSED before the rewrite. A rescan only ever sees what a render
 * put there, so nothing short of observation could have caught them.
 */
it('finds an element inserted after discovery was set up', async () => {
  const element = host();
  autoloader(entry, 'components')(element);
  await task();
  /** Nothing renders here — this is what any third-party widget or innerHTML call looks like. */
  element.innerHTML = '<late-arrival-widget></late-arrival-widget>';
  await until(() => customElements.get('late-arrival-widget'), "() => customElements.get('late-arrival-widget')", 4000);
  expect(customElements.get('late-arrival-widget'), 'found after insertion').to.be.a('function');
  element.remove();
});

it('finds an element that arrives inside a whole subtree at once', async () => {
  const element = host();
  autoloader(entry, 'components')(element);
  await task();
  element.innerHTML = '<section><div><deep-arrival-widget></deep-arrival-widget></div></section>';
  await until(() => customElements.get('deep-arrival-widget'), "() => customElements.get('deep-arrival-widget')", 4000);
  expect(customElements.get('deep-arrival-widget'), 'a subtree arrives as one added node')
    .to.be.a('function');
  element.remove();
});

it('autoload() finds markup it was never handed, and only when asked', async () => {
  const { asked, resolve } = recorder();
  const element = host('<static-widget></static-widget>');
  const autoload = autoloader(entry, 'components', { resolve });
  await task();
  expect(asked, 'creating an autoloader touches nothing').to.deep.equal([]);

  /** No element passed: the whole page, right now. The ask is synchronous, so it is also the control for the read above. */
  autoload();
  expect(asked).to.deep.equal(['components/static-widget']);
  await until(() => customElements.get('static-widget'), "() => customElements.get('static-widget')", 4000);
  expect(customElements.get('static-widget'), 'static markup loads with no render involved')
    .to.be.a('function');
  element.remove();
});

/* ── one tag, one module ─────────────────────────────────────────────────────────────────────── */
/**
 * `<x-y>` and `<x-y data-autoload-dir="alt">` are two URLs for one tag. Both used to import, and the
 * second module's `customElements.define` threw — reported as a failed load for a component that
 * had loaded fine.
 */
it('does not fetch a second directory for a tag already being loaded', async () => {
  const failures = [];
  const original = console.error;
  console.error = (...args) => failures.push(args.join(' '));
  const { asked, resolve } = recorder();
  const element = host('<dual-widget></dual-widget><dual-widget data-autoload-dir="alt"></dual-widget>');
  autoloader(entry, 'components', { resolve })(element);
  /** The only way to a duplicate define is a second import, and the scan that would ask for it is synchronous. */
  expect(asked, 'one directory asked, the first').to.deep.equal(['components/dual-widget']);
  await until(() => customElements.get('dual-widget'), "() => customElements.get('dual-widget')", 4000);
  console.error = original;

  expect(customElements.get('dual-widget')).to.be.a('function');
  expect(failures, 'no NotSupportedError from a duplicate define').to.have.length(0);
  element.remove();
});

/* ── a failure is reportable ─────────────────────────────────────────────────────────────────── */
it('dispatches vera:autoload-error when a component never arrives', async () => {
  const original = console.error;
  console.error = () => {};
  const element = host();
  const seen = [];
  element.addEventListener('vera:autoload-error', (event) => seen.push(event.detail));
  autoloader(entry, 'components')(element);
  await task();
  element.innerHTML = '<never-shipped-widget></never-shipped-widget>';
  await until(() => seen.length > 0, "() => seen.length > 0", 4000);
  console.error = original;

  expect(seen, 'one report').to.have.length(1);
  expect(seen[0].tag).to.equal('never-shipped-widget');
  expect(seen[0].src).to.contain('/components/never-shipped-widget.js');
  expect(seen[0].error, 'the underlying failure is carried').to.exist;
  element.remove();
});

/* ── bounding ────────────────────────────────────────────────────────────────────────────────── */
it('refuses an data-autoload-dir that resolves outside the entry directory', async () => {
  const refused = [];
  const original = console.error;
  console.error = (...args) => refused.push(args.join(' '));
  const element = host(`
    <esc-one data-autoload-dir="https://example.invalid/x"></esc-one>
    <esc-two data-autoload-dir="//example.invalid/x"></esc-two>
    <esc-three data-autoload-dir="../../.."></esc-three>`);
  autoloader(entry, 'components')(element);
  await until(() => refused.filter((m) => m.includes('refused')).length === 3, "() => refused.filter((m) => m.includes('refused')).length === 3", 4000);
  console.error = original;

  expect(refused.filter((m) => m.includes('refused')), 'all three escapes refused').to.have.length(3);
  expect(customElements.get('esc-one')).to.equal(undefined);
  element.remove();
});

/* ── url() ───────────────────────────────────────────────────────────────────────────────────── */
/**
 * The whole of what a `preload` helper used to wrap. With the URL in hand you can warm it however
 * you like — and do things the helper could not, like priming a service worker.
 */
it('url() is the URL the loader will ask for, and warming it works', async () => {
  const autoload = autoloader(entry, 'components');
  const href = autoload.url('preloaded-widget');
  expect(href).to.contain('/components/preloaded-widget.js');

  const link = document.createElement('link');
  link.rel = 'modulepreload';
  link.href = href;
  /** The fetch has finished (its load event), so a preload that evaluated would have defined the tag by now. */
  await new Promise((done, fail) => {
    link.onload = done;
    link.onerror = () => fail(new Error(`modulepreload of ${href} failed`));
    document.head.appendChild(link);
  });
  expect(customElements.get('preloaded-widget'), 'warming must not define it').to.equal(undefined);

  const element = host('<preloaded-widget></preloaded-widget>');
  autoload(element);
  await until(() => customElements.get('preloaded-widget'), "() => customElements.get('preloaded-widget')", 4000);
  expect(customElements.get('preloaded-widget'), 'the warmed URL is the one it fetched')
    .to.be.a('function');
  element.remove();
  link.remove();
});

/* ── retry ───────────────────────────────────────────────────────────────────────────────────── */
/**
 * A failed load is permanent for the page, which is right for a component that does not exist and
 * wrong for one lost to a dropped connection. `vera:autoload-error` hands you the tag; this is what
 * you do with it.
 */
/** A token per row: the fail-once route (web-test-runner.config.mjs) fails each path the first time only. */
const token = () => Math.random().toString(36).slice(2);

/** Whether an `import()` resolved or rejected: the outcome, not the error text, which differs by engine. */
const outcome = (url) => import(url).then(() => 'loaded', () => 'failed');

/**
 * **The one table: whether this engine keeps a failed module import**, keyed by what the page can see (engine and version;
 * the Playwright build that measured each is named, the page cannot read it). Chromium 159 (Playwright 1.65.1, build
 * 1255) keeps it: the same URL fails again without asking the server. Firefox 159 (build 1572) and WebKit 27 (build 2388)
 * ask again, and load; Firefox 153 (build 1538) and WebKit 26.5 (Playwright 1.62.1) kept it (2026-11-21). The platform row
 * checks this engine against it and is meant to go red when a browser bump changes the answer; the retry row takes what
 * that row MEASURED.
 */
const KEEPS_FAILED_IMPORT =
  ENGINE !== null && !((ENGINE.name === 'Firefox' && ENGINE.version >= 159) || (ENGINE.name === 'WebKit' && ENGINE.version >= 27));
/** What the platform row measured in this run — `undefined` until it has, which the retry row refuses. */
let measuredKeeps;

it('the engine is known from its user agent (the table below is never applied to an engine it does not name)', () => {
  /** The reader's own near-misses: each agent string read as the engine it is, and a bare one as none. */
  const read = (ua) => engineOf(ua)?.name ?? null;
  expect(read('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36')).to.equal('Chromium');
  expect(read('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/151.0.0.0 Safari/537.36')).to.equal('Chromium');
  expect(read('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15')).to.equal('WebKit');
  expect(read('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:159.0) Gecko/20100101 Firefox/159.0')).to.equal('Firefox');
  expect(read('Mozilla/5.0')).to.equal(null);
  expect(read('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)')).to.equal(null);
  expect(ENGINE, `user agent: ${navigator.userAgent}`).to.not.equal(null);
});

it('a failed module import, imported again: kept by Chromium (the same URL fails without asking the server), asked again by Firefox 159 and WebKit 27', async () => {
  const base = new URL(`./fixtures/autoloader/once/${token()}/once-probe.js`, import.meta.url).href;
  expect(await outcome(base), 'the first import met the 404').to.equal('failed');
  /** The route serves this path from now on, so a second failure is the engine's own record (one 404 in the run's log per path). */
  const again = await outcome(base);
  measuredKeeps = again === 'failed';
  expect(again, `${ON}: the same URL ${KEEPS_FAILED_IMPORT ? 'is not fetched again' : 'is fetched again, and loads'} (the table's answer; if this engine's build changed it, update KEEPS_FAILED_IMPORT and the BROWSER-LEDGER entry)`).to.equal(KEEPS_FAILED_IMPORT ? 'failed' : 'loaded');
  /**
   * CONTROL: the server does answer — through a new URL where the engine kept the failure, and through the same URL where it
   * asked again (the module then ran: importing it under a new URL would run it twice and define its tag twice, which throws).
   */
  if (measuredKeeps) expect(await outcome(`${base}?again`), `${ON}: CONTROL: a new URL for the same path is fetched, and loads`).to.equal('loaded');
  expect(customElements.get('once-probe'), `${ON}: and ran`).to.be.a('function');
});

/**
 * **A retry reaches the server, in every engine.** An engine may keep a failed module import (the row above), so `retry`
 * imports with `vera-retry=<n>` added, a URL the engine has not seen. The row waits for whichever comes, the tag defined
 * or a second `vera:autoload-error`, so a retry answered from the engine's record reads 'failed again' rather than timing
 * out.
 */
it('retry takes the element the error handed you, and tries it again, even where the engine keeps a failed import', async () => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  /**
   * The dropped connection that comes back: the same URL fails once, then loads, and nothing but this autoloader ever
   * asks for `retry-widget`, so the tag is defined only if `retry` imports again. A second autoloader used to stand in
   * for the network coming back and defined the tag itself, so the row passed with `retry` doing nothing.
   */
  const once = token();
  const flaky = autoloader(entry, 'components', { resolve: (tag) => `once/${once}/${tag}.js` });
  const element = host('<retry-widget></retry-widget>');
  const reports = [];
  element.addEventListener('vera:autoload-error', (event) => reports.push(event.detail));
  try {
    flaky(element);
    await until(() => reports.length === 1, 'the first attempt reported its failure', 4000);
    expect(customElements.get('retry-widget'), 'the first attempt failed').to.equal(undefined);
    expect(reports[0].element, 'the event carries the element').to.equal(element.querySelector('retry-widget'));
    expect(errors.length, 'and the failure was printed').to.be.above(0);

    flaky.retry(reports[0].element);
    const result = await until(
      () => (customElements.get('retry-widget') ? 'loaded' : reports.length === 2 ? 'failed again' : false),
      'the retry to load or to report',
      4000,
    );
    /** The platform row measured this engine in this run: where it keeps a failed import, this row is the fix's test. */
    expect(measuredKeeps, `${ON}: the platform row measured this engine first`).to.be.a('boolean');
    expect(result, `${ON}: retry asks the server again (this engine ${measuredKeeps ? 'keeps' : 'does not keep'} a failed import)`).to.equal('loaded');
    expect(reports.length, `${ON}: and reported no second failure`).to.equal(1);
  } finally {
    console.error = original;
    element.remove();
  }
});

/**
 * A retry row's harness: an autoloader on the fail-once route, an element per tag, the reports it fires, and its
 * printed errors kept off the console (the route's first 404 is meant to fail). `asked()` counts the load attempts:
 * the autoloader calls `resolve` synchronously as each one starts, so a retry that starts none reads at once, with no
 * wait for an import that might arrive late.
 */
const flakyHost = (tags, path) => {
  const original = console.error;
  console.error = () => {};
  const once = token();
  let attempts = 0;
  const resolve = (tag) => (attempts++, `once/${once}/${path(tag)}`);
  const loader = autoloader(entry, 'components', { resolve });
  const element = host(tags.map((tag) => `<${tag}></${tag}>`).join(''));
  const reports = [];
  element.addEventListener('vera:autoload-error', (event) => reports.push(event.detail));
  const done = () => {
    console.error = original;
    element.remove();
  };
  return { loader, element, reports, done, asked: () => attempts };
};
/** How many times the fail-once route's module for `tag` has run in this page. */
const runs = (tag) => globalThis.veraOnceRuns?.[tag] ?? 0;

it('a module that defined its tag and then threw is not run again by retry', async () => {
  const { loader, element, reports, done, asked } = flakyHost(['threw-widget'], (tag) => `${tag}.js?then=throw`);
  try {
    loader(element);
    await until(() => reports.length === 1, 'the first attempt met the 404', 4000);
    loader.retry(reports[0].element);
    expect(asked(), `${ON}: CONTROL: the first retry started a load (the counter counts)`).to.equal(2);
    /** The retry ran the module: it defined the tag, then threw, which rejects the import and reports a second time. */
    await until(() => reports.length === 2, 'the retry to report the throw', 4000);
    expect(runs('threw-widget'), `${ON}: CONTROL: the retry ran the module once`).to.equal(1);
    expect(customElements.get('threw-widget'), `${ON}: and it defined its tag before throwing`).to.be.a('function');
    /** An app retries every element its reports handed it; this one's tag is defined, so no load starts. */
    loader.retry(reports[1].element);
    expect(asked(), `${ON}: a retry of a defined tag starts no load`).to.equal(2);
    expect(element.querySelector('threw-widget')).to.be.instanceOf(customElements.get('threw-widget'));
  } finally {
    done();
  }
});

it('one module holding two tags: retry runs it once, and both tags arrive', async () => {
  const { loader, element, reports, done, asked } = flakyHost(['pair-a', 'pair-b'], () => 'pair-a.js?also=pair-b');
  try {
    loader(element);
    await until(() => reports.length === 1, 'the first attempt met the 404', 4000);
    expect(reports[0].element.localName, 'the shared URL is asked for once, so one tag reports').to.equal('pair-a');
    loader.retry(reports[0].element);
    await until(() => customElements.get('pair-a') && customElements.get('pair-b'), 'both tags defined by the retry', 4000);
    const before = asked();
    loader.retry(element.querySelector('pair-b'));
    expect(asked(), `${ON}: retrying the other tag starts no load`).to.equal(before);
    expect(runs('pair-a'), `${ON}: the shared module ran once`).to.equal(1);
    expect(reports.length, `${ON}: and nothing failed after the retry`).to.equal(1);
  } finally {
    done();
  }
});

it('retry pressed twice while the first is loading imports once', async () => {
  const { loader, element, reports, done, asked } = flakyHost(['double-widget'], (tag) => `${tag}.js`);
  try {
    loader(element);
    await until(() => reports.length === 1, 'the first attempt met the 404', 4000);
    loader.retry(reports[0].element);
    expect(asked(), `${ON}: CONTROL: the first press started a load`).to.equal(2);
    loader.retry(reports[0].element);
    expect(asked(), `${ON}: the second press, while it loads, starts none (a second fresh URL would run the module twice)`).to.equal(2);
    await until(() => customElements.get('double-widget'), 'the retry to load', 4000);
    expect(runs('double-widget'), `${ON}: the module ran once`).to.equal(1);
  } finally {
    done();
  }
});

/* ── an import map's integrity pin ───────────────────────────────────────────────────────────── */
/**
 * An import map's `integrity` is keyed by URL, so a retry under `vera-retry=<n>` would load a pinned file unchecked.
 * Both rows run in a fresh frame, since an import map must come before the page's first module.
 */
const sri = async (url) => {
  const bytes = await (await fetch(url, { cache: 'no-store' })).arrayBuffer();
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-384', bytes));
  return `sha384-${btoa(String.fromCharCode(...digest))}`;
};
/** Runs `body` (a module script's statements, ending in `return <result>`) in a fresh frame under the import map `map`. */
const framed = (map, body) =>
  new Promise((resolve, reject) => {
    const id = token();
    const frame = document.createElement('iframe');
    const timer = setTimeout(() => reject(new Error('the frame never answered')), 8000);
    const onMessage = (event) => {
      if (event.data?.id !== id) return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(event.data.result);
    };
    window.addEventListener('message', onMessage);
    const json = JSON.stringify(map).replace(/</g, '\\u003c');
    frame.srcdoc =
      `<script type="importmap">${json}</script>` +
      `<script type="module">const run = async () => { ${body} };\n` +
      `parent.postMessage({ id: '${id}', result: await run().catch((error) => ({ error: String(error) })) }, '*');</script>`;
    document.body.append(frame);
  });
const pinnedFile = (name) => new URL(`./fixtures/autoloader/pinned/${name}`, import.meta.url).href;

it('an import map pins a URL, not a file: the same file under a new query loads unchecked (why a pinned URL is retried as it is)', async () => {
  const a = pinnedFile('a.js');
  const b = pinnedFile('b.js');
  /** b.js is pinned with a.js's hash, which it does not have. */
  const integrity = { [a]: await sri(a), [b]: await sri(a) };
  const outcomes = `const outcome = (url) => import(url).then(() => 'loaded', () => 'failed');`;
  const result = await framed(
    { integrity },
    `${outcomes} return { a: await outcome('${a}'), b: await outcome('${b}'), fresh: await outcome('${b}?vera-retry=1') };`,
  );
  expect(result.a, `${ON}: CONTROL: a file with its own hash loads`).to.equal('loaded');
  expect(result.b, `${ON}: a file with the wrong hash is refused`).to.equal('failed');
  expect(result.fresh, `${ON}: the same file under a new query is not checked, and loads`).to.equal('loaded');
});

/**
 * A frame body: an autoloader whose `resolve` answers `src` for `<pinned-d>`, a first load that fails its check, one
 * retry, and what came of it. `before` runs first (a control of the map itself).
 */
const pinRetry = (src, before = 'const control = null;') => {
  const auto = new URL('../../packages/autoloader/dist/development/vera-autoloader.js', import.meta.url).href;
  return `${before}
    const { autoloader } = await import('${auto}');
    console.error = () => {};
    const wait = async (ok) => { for (let i = 0; i < 80 && !ok(); i++) await new Promise((r) => setTimeout(r, 50)); };
    const loader = autoloader('${entry}', 'components', { resolve: () => '${src}' });
    const host = document.createElement('div');
    host.setAttribute('data-autoload', '');
    host.innerHTML = '<pinned-d></pinned-d>';
    document.body.append(host);
    const reports = [];
    host.addEventListener('vera:autoload-error', (event) => reports.push(event.detail));
    loader(host);
    await wait(() => reports.length === 1);
    const first = reports.length;
    loader.retry(reports[0].element);
    await wait(() => reports.length === 2 || customElements.get('pinned-d'));
    return { control, first, reports: reports.length, defined: customElements.get('pinned-d') !== undefined };`;
};
const expectStillRefused = (result) => {
  expect(result.error, `${ON}: the frame ran`).to.equal(undefined);
  expect(result.first, `${ON}: CONTROL: the first import failed its check`).to.equal(1);
  expect(result.defined, `${ON}: the retry did not load the file unchecked`).to.equal(false);
  expect(result.reports, `${ON}: it failed its check again, and said so`).to.equal(2);
};

it('retry imports an integrity-pinned URL as it is, so a file that failed its check stays refused', async () => {
  const d = pinnedFile('d.js');
  expectStillRefused(await framed({ integrity: { [d]: await sri(pinnedFile('a.js')) } }, pinRetry(d)));
});

it('a pin reached through an import-map remap is kept too: the hash is keyed by the URL the map resolves to', async () => {
  /** `alias/` exists only through the map, which sends it to `pinned/`; the pin names the resolved `pinned/d.js`. */
  const alias = new URL('./fixtures/autoloader/pinned/alias/', import.meta.url).href;
  const map = {
    imports: { [alias]: pinnedFile('') },
    integrity: { [pinnedFile('d.js')]: await sri(pinnedFile('a.js')), [pinnedFile('a.js')]: await sri(pinnedFile('a.js')) },
  };
  const control = `const control = await import('${alias}a.js').then((m) => m.default, () => 'failed');`;
  const result = await framed(map, pinRetry(`${alias}d.js`, control));
  expect(result.control, `${ON}: CONTROL: the map remaps alias/ (alias/a.js loads, through the map only)`).to.equal('a');
  expectStillRefused(result);
});

/* ── a shadow root handed over directly ──────────────────────────────────────────────────────── */
/**
 * An observer cannot cross a shadow boundary, so a component that does not mark itself is out of
 * reach — including a third-party one holding tags of yours. Passing the root *is* the opt-in.
 */
it('watches a shadow root it is handed, without an autoloader attribute', async () => {
  const outsider = document.createElement('div');
  document.body.appendChild(outsider);
  const root = outsider.attachShadow({ mode: 'open' });
  root.innerHTML = '<shadowed-widget></shadowed-widget>';

  const { asked, resolve } = recorder();
  const autoload = autoloader(entry, 'components', { resolve });
  autoload(outsider);
  await task();
  expect(asked, 'the host never opted in').to.deep.equal([]);

  /** The ask is synchronous, so it is also the control for the read above. */
  autoload(root);
  expect(asked).to.deep.equal(['components/shadowed-widget']);
  await until(() => customElements.get('shadowed-widget'), "() => customElements.get('shadowed-widget')", 4000);
  expect(customElements.get('shadowed-widget'), 'handing over the root is the opt-in').to.be.a('function');
  outsider.remove();
});


/* ── a document is a document before it has a body ───────────────────────────────────────────── */
/**
 * `autoload()` means "sweep the page for `[data-autoload]` hosts". A document used to be recognized by
 * having a `body`, which is null until the parser reaches it — so the same call from a classic or
 * `async` module script in `<head>` fell through to the branch that watches a *root*, and quietly
 * put a `subtree: true` observer on `document` itself. That is the whole-document shape this module
 * is built to avoid, it survived for the life of the page, and nothing reported it.
 *
 * Asserted through the observer rather than through behavior, because the wrong branch still
 * *works* — it loads more, faster, at a cost spread across every mutation in the app. Only the
 * target it observed tells the two apart.
 */
it('sweeps for marked hosts rather than observing the whole document', async () => {
  const targets = [];
  const Real = window.MutationObserver;
  window.MutationObserver = class extends Real {
    observe(target, options) {
      targets.push(target);
      return super.observe(target, options);
    }
  };

  try {
    const marked = host('<swept-widget></swept-widget>');
    const autoload = autoloader(entry, 'components');
    /**
     * The condition the branch got wrong — a document that exists but whose body has not been
     * parsed yet, which is what an `async` module script in `<head>` sees. Modeled rather than
     * staged, because a test file cannot un-parse the page it is running in.
     */
    Object.defineProperty(document, 'body', { get: () => null, configurable: true });
    try { autoload(); } finally { delete document.body; }
    await until(() => customElements.get('swept-widget'), "() => customElements.get('swept-widget')", 4000);

    expect(customElements.get('swept-widget'), 'the sweep still finds marked hosts').to.be.a('function');
    expect(targets.includes(document), 'document is never the observed root').to.equal(false);
    expect(targets.includes(marked), 'the marked host is').to.equal(true);
    marked.remove();
  } finally {
    window.MutationObserver = Real;
  }
});
