import { expect } from '@esm-bundle/chai';
import { initAutoloader } from '../../packages/autoloader/dist/development/vera-autoloader.js';

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
  initAutoloader(entry, 'components')(element);
  await until(() => customElements.get('probe-widget'));

  expect(customElements.get('probe-widget'), 'the definition arrived').to.be.a('function');
  expect(element.querySelector('probe-widget').textContent).to.equal('probe');
  element.remove();
});

it('autoload-dir moves one element to another directory inside the base', async () => {
  const element = host('<alt-widget autoload-dir="alt"></alt-widget>');
  initAutoloader(entry, 'components')(element);
  await until(() => customElements.get('alt-widget'));
  expect(customElements.get('alt-widget')).to.be.a('function');
  element.remove();
});

it('an element marked autoload-ignore is left alone', async () => {
  const element = host('<skipped-widget autoload-ignore></skipped-widget>');
  initAutoloader(entry, 'components')(element);
  await settle();
  expect(customElements.get('skipped-widget')).to.equal(undefined);
  element.remove();
});

it('a host without the autoloader attribute is never watched', async () => {
  const element = document.createElement('div');
  element.innerHTML = '<unscanned-widget></unscanned-widget>';
  document.body.appendChild(element);
  initAutoloader(entry, 'components')(element);
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
  initAutoloader(entry, 'components')(element);
  await settle();
  /** Nothing renders here — this is what any third-party widget or innerHTML call looks like. */
  element.innerHTML = '<late-arrival-widget></late-arrival-widget>';
  await until(() => customElements.get('late-arrival-widget'));
  expect(customElements.get('late-arrival-widget'), 'found after insertion').to.be.a('function');
  element.remove();
});

it('finds an element that arrives inside a whole subtree at once', async () => {
  const element = host();
  initAutoloader(entry, 'components')(element);
  await settle();
  element.innerHTML = '<section><div><deep-arrival-widget></deep-arrival-widget></div></section>';
  await until(() => customElements.get('deep-arrival-widget'));
  expect(customElements.get('deep-arrival-widget'), 'a subtree arrives as one added node')
    .to.be.a('function');
  element.remove();
});

it('finds markup that was already in the document when the autoloader was created', async () => {
  const element = host('<static-widget></static-widget>');
  /** No `watch` call at all — the sweep at creation is what has to find this. */
  initAutoloader(entry, 'components');
  await until(() => customElements.get('static-widget'));
  expect(customElements.get('static-widget'), 'static markup loads without any render').to.be.a('function');
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
  initAutoloader(entry, 'components')(element);
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
  initAutoloader(entry, 'components')(element);
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
  initAutoloader(entry, 'components')(element);
  await until(() => refused.filter((m) => m.includes('refused')).length === 3);
  console.error = original;

  expect(refused.filter((m) => m.includes('refused')), 'all three escapes refused').to.have.length(3);
  expect(customElements.get('esc-one')).to.equal(undefined);
  element.remove();
});

/* ── preload ─────────────────────────────────────────────────────────────────────────────────── */
it('preload warms a module without running it', async () => {
  const autoloader = initAutoloader(entry, 'components', { sweep: false });
  autoloader.preload('preloaded-widget');

  const link = [...document.head.querySelectorAll('link[rel="modulepreload"]')]
    .find((l) => l.href.includes('preloaded-widget'));
  expect(link, 'a modulepreload link was added').to.exist;
  expect(link.href).to.contain('/components/preloaded-widget.js');
  await settle();
  expect(customElements.get('preloaded-widget'), 'warming must not define it').to.equal(undefined);

  /** And the warmed URL is the one the loader then asks for. */
  const element = host('<preloaded-widget></preloaded-widget>');
  autoloader(element);
  await until(() => customElements.get('preloaded-widget'));
  expect(customElements.get('preloaded-widget')).to.be.a('function');
  element.remove();
  link.remove();
});

it('preload refuses a tag that would resolve outside the base', () => {
  const refused = [];
  const original = console.error;
  console.error = (...args) => refused.push(args.join(' '));
  initAutoloader(entry, '../../..', { sweep: false }).preload('escaped-widget');
  console.error = original;
  expect(refused.filter((m) => m.includes('refused'))).to.have.length(1);
});

/* ── retry ───────────────────────────────────────────────────────────────────────────────────── */
/**
 * A failed load is permanent for the page, which is right for a component that does not exist and
 * wrong for one lost to a dropped connection. `vera:autoload-error` hands you the tag; this is what
 * you do with it.
 */
it('retry forgets a failure and tries again where the tag appears', async () => {
  const original = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(' '));

  const autoloader = initAutoloader(entry, 'missing-dir', { sweep: false });
  const element = host('<flaky-widget></flaky-widget>');
  autoloader(element);
  await until(() => errors.length > 0);
  expect(customElements.get('flaky-widget'), 'the first attempt failed').to.equal(undefined);

  /** The component is reachable now — a second autoloader stands in for the network coming back. */
  const working = initAutoloader(entry, 'components', { sweep: false });
  working(host('<flaky-widget></flaky-widget>'));
  await settle();
  console.error = original;

  /** Without retry the tag stays memoised as failed on the first autoloader. */
  autoloader.retry('flaky-widget');
  await until(() => customElements.get('flaky-widget'));
  expect(customElements.get('flaky-widget'), 'reachable after retry').to.be.a('function');
  element.remove();
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

  const autoloader = initAutoloader(entry, 'components', { sweep: false });
  autoloader(outsider);
  await settle();
  expect(customElements.get('shadowed-widget'), 'the host never opted in').to.equal(undefined);

  autoloader(root);
  await until(() => customElements.get('shadowed-widget'));
  expect(customElements.get('shadowed-widget'), 'handing over the root is the opt-in').to.be.a('function');
  outsider.remove();
});

/* ── sweep ───────────────────────────────────────────────────────────────────────────────────── */
it('sweep: false leaves existing marked hosts alone', async () => {
  const element = host('<unswept-widget></unswept-widget>');
  initAutoloader(entry, 'components', { sweep: false });
  await settle();
  expect(customElements.get('unswept-widget')).to.equal(undefined);
  element.remove();
});
