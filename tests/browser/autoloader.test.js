import { expect } from '@esm-bundle/chai';
import { autoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';

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
const until = (condition, timeout = 4000) =>
  new Promise((resolve) => {
    const deadline = Date.now() + timeout;
    const poll = () => {
      if (condition() || Date.now() > deadline) resolve(condition());
      else setTimeout(poll, 10);
    };
    poll();
  });

/** For asserting that nothing happens, where there is no positive signal to wait for. */
const settle = () => new Promise((r) => setTimeout(r, 300));

const host = (html) => {
  const element = document.createElement('div');
  element.setAttribute('autoloader', '');
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
  await until(() => customElements.get('probe-widget'));

  expect(customElements.get('probe-widget'), 'the definition arrived').to.be.a('function');
  expect(element.querySelector('probe-widget').textContent).to.equal('probe');
  element.remove();
});

it('autoload-dir moves one element to another directory inside the base', async () => {
  const element = host('<alt-widget autoload-dir="alt"></alt-widget>');
  autoloader(entry, 'components')(element);
  await until(() => customElements.get('alt-widget'));
  expect(customElements.get('alt-widget')).to.be.a('function');
  element.remove();
});

it('an element marked autoload-ignore is left alone', async () => {
  const element = host('<skipped-widget autoload-ignore></skipped-widget>');
  autoloader(entry, 'components')(element);
  await settle();
  expect(customElements.get('skipped-widget')).to.equal(undefined);
  element.remove();
});

it('a host without the autoloader attribute is never watched', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<unscanned-widget></unscanned-widget>';
  document.body.appendChild(element);
  autoloader(entry, 'components')(element);
  await settle();
  expect(customElements.get('unscanned-widget')).to.equal(undefined);
  element.remove();
});

/* ── the holes the rescan model could not close ──────────────────────────────────────────────── */
/**
 * Each of these was measured as MISSED before the rewrite. A rescan only ever sees what a render
 * put there, so nothing short of observation could have caught them.
 */
it('finds an element inserted after discovery was set up', async () => {
  const element = host();
  autoloader(entry, 'components')(element);
  await settle();
  /** Nothing renders here — this is what any third-party widget or innerHTML call looks like. */
  element.innerHTML = '<late-arrival-widget></late-arrival-widget>';
  await until(() => customElements.get('late-arrival-widget'));
  expect(customElements.get('late-arrival-widget'), 'found after insertion').to.be.a('function');
  element.remove();
});

it('finds an element that arrives inside a whole subtree at once', async () => {
  const element = host();
  autoloader(entry, 'components')(element);
  await settle();
  element.innerHTML = '<section><div><deep-arrival-widget></deep-arrival-widget></div></section>';
  await until(() => customElements.get('deep-arrival-widget'));
  expect(customElements.get('deep-arrival-widget'), 'a subtree arrives as one added node')
    .to.be.a('function');
  element.remove();
});

it('autoload() finds markup it was never handed, and only when asked', async () => {
  const element = host('<static-widget></static-widget>');
  const autoload = autoloader(entry, 'components');
  await settle();
  expect(customElements.get('static-widget'), 'creating an autoloader touches nothing')
    .to.equal(undefined);

  /** No element passed: the whole page, right now. */
  autoload();
  await until(() => customElements.get('static-widget'));
  expect(customElements.get('static-widget'), 'static markup loads with no render involved')
    .to.be.a('function');
  element.remove();
});

/* ── one tag, one module ─────────────────────────────────────────────────────────────────────── */
/**
 * `<x-y>` and `<x-y autoload-dir="alt">` are two URLs for one tag. Both used to import, and the
 * second module's `customElements.define` threw — reported as a failed load for a component that
 * had loaded fine.
 */
it('does not fetch a second directory for a tag already being loaded', async () => {
  const failures = [];
  const original = console.error;
  console.error = (...args) => failures.push(args.join(' '));
  const element = host('<dual-widget></dual-widget><dual-widget autoload-dir="alt"></dual-widget>');
  autoloader(entry, 'components')(element);
  await until(() => customElements.get('dual-widget'));
  await settle();
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
  await settle();
  element.innerHTML = '<never-shipped-widget></never-shipped-widget>';
  await until(() => seen.length > 0);
  console.error = original;

  expect(seen, 'one report').to.have.length(1);
  expect(seen[0].tag).to.equal('never-shipped-widget');
  expect(seen[0].src).to.contain('/components/never-shipped-widget.js');
  expect(seen[0].error, 'the underlying failure is carried').to.exist;
  element.remove();
});

/* ── bounding ────────────────────────────────────────────────────────────────────────────────── */
it('refuses an autoload-dir that resolves outside the entry directory', async () => {
  const refused = [];
  const original = console.error;
  console.error = (...args) => refused.push(args.join(' '));
  const element = host(`
    <esc-one autoload-dir="https://example.invalid/x"></esc-one>
    <esc-two autoload-dir="//example.invalid/x"></esc-two>
    <esc-three autoload-dir="../../.."></esc-three>`);
  autoloader(entry, 'components')(element);
  await until(() => refused.filter((m) => m.includes('refused')).length === 3);
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
  document.head.appendChild(link);
  await settle();
  expect(customElements.get('preloaded-widget'), 'warming must not define it').to.equal(undefined);

  const element = host('<preloaded-widget></preloaded-widget>');
  autoload(element);
  await until(() => customElements.get('preloaded-widget'));
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
it('retry takes the element the error handed you, and tries it again', async () => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  const failing = autoloader(entry, 'missing-dir');
  const element = host('<flaky-widget></flaky-widget>');
  let reported;
  element.addEventListener('vera:autoload-error', (event) => { reported = event.detail; });
  failing(element);
  await until(() => errors.length > 0);
  expect(customElements.get('flaky-widget'), 'the first attempt failed').to.equal(undefined);
  expect(reported.element, 'the event carries the element').to.equal(element.querySelector('flaky-widget'));

  /** The component is reachable now — a second autoloader stands in for the network coming back. */
  const working = autoloader(entry, 'components');
  const other = host('<flaky-widget></flaky-widget>');
  working(other);
  await settle();
  console.error = original;

  /** Without retry the tag stays memoised as failed on the first autoloader. */
  failing.retry(reported.element);
  await until(() => customElements.get('flaky-widget'));
  expect(customElements.get('flaky-widget'), 'reachable after retry').to.be.a('function');
  element.remove();
  other.remove();
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

  const autoload = autoloader(entry, 'components');
  autoload(outsider);
  await settle();
  expect(customElements.get('shadowed-widget'), 'the host never opted in').to.equal(undefined);

  autoload(root);
  await until(() => customElements.get('shadowed-widget'));
  expect(customElements.get('shadowed-widget'), 'handing over the root is the opt-in').to.be.a('function');
  outsider.remove();
});


/* ── a document is a document before it has a body ───────────────────────────────────────────── */
/**
 * `autoload()` means "sweep the page for `[autoloader]` hosts". A document used to be recognised by
 * having a `body`, which is null until the parser reaches it — so the same call from a classic or
 * `async` module script in `<head>` fell through to the branch that watches a *root*, and quietly
 * put a `subtree: true` observer on `document` itself. That is the whole-document shape this module
 * is built to avoid, it survived for the life of the page, and nothing reported it.
 *
 * Asserted through the observer rather than through behaviour, because the wrong branch still
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
     * parsed yet, which is what an `async` module script in `<head>` sees. Modelled rather than
     * staged, because a test file cannot un-parse the page it is running in.
     */
    Object.defineProperty(document, 'body', { get: () => null, configurable: true });
    try { autoload(); } finally { delete document.body; }
    await until(() => customElements.get('swept-widget'));

    expect(customElements.get('swept-widget'), 'the sweep still finds marked hosts').to.be.a('function');
    expect(targets.includes(document), 'document is never the observed root').to.equal(false);
    expect(targets.includes(marked), 'the marked host is').to.equal(true);
    marked.remove();
  } finally {
    window.MutationObserver = Real;
  }
});
