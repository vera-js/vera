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
  const discover = initAutoloader(entry, 'components');
  const element = host('<probe-widget></probe-widget>');
  discover(element);
  await until(() => customElements.get('probe-widget'));

  expect(customElements.get('probe-widget'), 'the definition arrived').to.be.a('function');
  expect(element.querySelector('probe-widget').textContent).to.equal('probe');
  element.remove();
});

it('autoload-dir moves one element to another directory inside the base', async () => {
  const discover = initAutoloader(entry, 'components');
  const element = host('<alt-widget autoload-dir="alt"></alt-widget>');
  discover(element);
  await until(() => customElements.get('alt-widget'));
  expect(customElements.get('alt-widget')).to.be.a('function');
  element.remove();
});

it('an element marked autoload-ignore is left alone', async () => {
  const discover = initAutoloader(entry, 'components');
  const element = host('<skipped-widget autoload-ignore></skipped-widget>');
  discover(element);
  await settle();
  expect(customElements.get('skipped-widget')).to.equal(undefined);
  element.remove();
});

it('a host without the autoloader attribute is never scanned', async () => {
  const discover = initAutoloader(entry, 'components');
  const element = document.createElement('div');
  element.innerHTML = '<unscanned-widget></unscanned-widget>';
  document.body.appendChild(element);
  discover(element);
  await settle();
  expect(customElements.get('unscanned-widget')).to.equal(undefined);
  element.remove();
});

/* ── bounding ────────────────────────────────────────────────────────────────────────────────── */
it('refuses an autoload-dir that resolves outside the entry directory', async () => {
  const refused = [];
  const original = console.error;
  console.error = (...args) => refused.push(args.join(' '));
  const discover = initAutoloader(entry, 'components');
  const element = host(`
    <esc-one autoload-dir="https://example.invalid/x"></esc-one>
    <esc-two autoload-dir="//example.invalid/x"></esc-two>
    <esc-three autoload-dir="../../.."></esc-three>`);
  discover(element);
  await until(() => refused.filter((m) => m.includes('refused')).length === 3);
  console.error = original;

  expect(refused.filter((m) => m.includes('refused')), 'all three escapes refused').to.have.length(3);
  expect(customElements.get('esc-one')).to.equal(undefined);
  element.remove();
});
