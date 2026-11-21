/**
 * **`@vera-hooks/announce`: one live region per document, and the settle window a spinner speaks through.** Each row
 * is one line of the sign-off sheet (the surface, and principles 1, 2, 5, 6, 8, 10, 11, 12) or one of its review's
 * amendments.
 *
 * jsdom is the regression net, never the oracle: whether a screen reader SPEAKS a write, and modals (jsdom has no
 * `:modal`), live in the browser suite. These rows hold what the hook decides and writes. Its timers run on a queue the
 * row drives (`clock`), so every "said" and "said nothing" is read after exactly the timers that would have said it,
 * never after a sleep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const GLOBALS = ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Event'];

/** A fresh document, the globals pointed at it, and its window's timers on a queue this row drives. */
const page = (markup = '') => {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { url: 'http://localhost/' });
  for (const key of GLOBALS) globalThis[key] = dom.window[key];
  const win = dom.window;
  const queue = new Map();
  let next = 0;
  win.setTimeout = (fn, ms) => (queue.set(++next, { fn, ms }), next);
  win.clearTimeout = (id) => void queue.delete(id);
  /** Runs every queued timer, and any it queues, in the order queued. */
  const run = () => {
    while (queue.size > 0) {
      const [id, { fn }] = queue.entries().next().value;
      queue.delete(id);
      fn();
    }
  };
  return { doc: win.document, win, queue, run };
};

const regions = (doc) => [...doc.querySelectorAll('[data-vera-announce]')];
const said = (doc, politeness = 'polite') => doc.querySelector(`[data-vera-announce="${politeness}"]`)?.textContent ?? null;

const { announce, want } = await load('vera-hooks/announce');
/** A second copy of the hook: its own module instance, as a page with two bundles has. */
const copy = await load('vera-hooks/announce', '?second-copy');

test('a polite announcement: one hidden region on body, cleared now and written a task later', () => {
  const { doc, queue, run } = page('<button>b</button>');
  announce(doc.querySelector('button'), 'Saved');
  const [region] = regions(doc);
  assert.equal(regions(doc).length, 1);
  assert.equal(region.parentNode, doc.body);
  assert.equal(region.textContent, '', 'nothing written yet');
  assert.equal(queue.size, 1);
  run();
  assert.equal(said(doc), 'Saved');
});

test("the region's attributes are aria-live and aria-atomic, and it is hidden without leaving the accessibility tree", () => {
  const { doc, run } = page('<p>x</p>');
  announce(doc.querySelector('p'), 'Hi');
  run();
  const [region] = regions(doc);
  assert.deepEqual(
    region.getAttributeNames().sort(),
    ['aria-atomic', 'aria-live', 'data-vera-announce', 'style'],
    'no role, nothing else',
  );
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.getAttribute('aria-atomic'), 'true');
  assert.notEqual(region.style.display, 'none', 'display: none would silence it');
  assert.notEqual(region.style.visibility, 'hidden', 'so would visibility: hidden');
  assert.equal(region.style.clipPath, 'inset(50%)');
});

test('the same text twice is cleared between, so it is heard twice', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'Copied');
  run();
  announce(p, 'Copied');
  assert.equal(said(doc), '', 'cleared before the repeat');
  run();
  assert.equal(said(doc), 'Copied');
});

test('the first write into a new region waits longer than the next ones (a region written as it is inserted is not spoken)', () => {
  const { doc, queue, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'one');
  const first = [...queue.values()][0].ms;
  run();
  announce(p, 'two');
  const later = [...queue.values()][0].ms;
  run();
  assert.ok(first > later, `first ${first} ms, later ${later} ms`);
});

test('assertive gets its own region, made only when asked', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'polite one');
  run();
  assert.equal(said(doc, 'assertive'), null, 'no assertive region until asked');
  announce(p, 'Card declined', { politeness: 'assertive' });
  run();
  assert.equal(said(doc, 'assertive'), 'Card declined');
  assert.equal(said(doc), 'polite one', 'the polite region kept its own');
  assert.equal(regions(doc).length, 2);
});

test('a key collapses announcements within one write window to the last', () => {
  const { doc, queue, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, '3 characters left', { key: 'count' });
  announce(p, '2 characters left', { key: 'count' });
  announce(p, '1 character left', { key: 'count' });
  assert.equal(queue.size, 1, 'one write pending');
  run();
  assert.equal(said(doc), '1 character left');
});

test('two copies of the hook on one page share one region (two regions would speak everything twice)', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  assert.notEqual(copy.announce, announce, 'CONTROL: two module instances');
  announce(p, 'from the first');
  run();
  copy.announce(p, 'from the second');
  run();
  assert.equal(regions(doc).length, 1);
  assert.equal(said(doc), 'from the second');
});

test('a page that empties body gets its region back, still exactly one', () => {
  const { doc, run } = page('<p>x</p>');
  announce(doc.querySelector('p'), 'before');
  run();
  doc.body.innerHTML = '<p>y</p>';
  assert.equal(regions(doc).length, 0, 'CONTROL: the region went with body');
  announce(doc.querySelector('p'), 'after');
  run();
  assert.equal(regions(doc).length, 1);
  assert.equal(said(doc), 'after');
});

test('an element in a user shadow root speaks through its document region', () => {
  const { doc, run } = page('<div id="host"></div>');
  const root = doc.querySelector('#host').attachShadow({ mode: 'open' });
  root.innerHTML = '<button>in shadow</button>';
  announce(root.querySelector('button'), 'From the shadow');
  run();
  assert.equal(root.querySelectorAll('[data-vera-announce]').length, 0, 'no region inside the shadow root');
  assert.equal(said(doc), 'From the shadow');
});

test('an iframe has its own region, in its own document', () => {
  const { doc, run } = page('<p>x</p><iframe></iframe>');
  const inner = doc.querySelector('iframe').contentDocument;
  inner.body.innerHTML = '<p>in</p>';
  const innerQueue = [];
  inner.defaultView.setTimeout = (fn) => (innerQueue.push(fn), innerQueue.length);
  announce(inner.querySelector('p'), 'Inside');
  innerQueue.splice(0).forEach((fn) => fn());
  run();
  assert.equal(said(inner), 'Inside');
  assert.equal(regions(doc).length, 0, 'the outer document has none');
});

test('a document with no window says nothing and throws nothing', () => {
  const { doc, queue } = page();
  const detached = doc.implementation.createHTMLDocument('x');
  const p = detached.body.appendChild(detached.createElement('p'));
  assert.equal(detached.defaultView, null, 'CONTROL: no window');
  announce(p, 'nobody');
  assert.equal(regions(detached).length, 0);
  assert.equal(queue.size, 0, 'nothing queued anywhere');
  const wanted = want(p, 'Loading');
  wanted.release();
});

test('a hidden tab queues nothing: an announcement nobody is there to hear is stale by their return', () => {
  const { doc, queue } = page('<p>x</p>');
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  announce(doc.querySelector('p'), 'unheard');
  assert.equal(queue.size, 0);
  assert.equal(regions(doc).length, 0);
});

test('a hostile string is text: no element is made from it', () => {
  const { doc, run } = page('<p>x</p>');
  const hostile = '<img src=x onerror="globalThis.ran=1"><script>globalThis.ran=1</script>';
  announce(doc.querySelector('p'), hostile);
  run();
  const [region] = regions(doc);
  assert.equal(region.textContent, hostile);
  assert.equal(region.children.length, 0);
});

test('want(): a label still wanted when the window closes is said once', () => {
  const { doc, queue, run } = page('<p>x</p>');
  want(doc.querySelector('p'), 'Loading');
  assert.equal(queue.size, 1, 'the window');
  assert.equal(regions(doc).length, 0, 'nothing before the window closes');
  run();
  assert.equal(said(doc), 'Loading');
  assert.equal(queue.size, 0, 'no timer left at rest');
});

test('want(): released inside the window, it says nothing (a fast load is silent)', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  want(p, 'Loading').release();
  /** CONTROL in the same window: another label is said, so the window did close and speak. */
  want(p, 'Saving');
  run();
  assert.equal(said(doc), 'Saving');
});

test('want(): an element that left the document inside the window says nothing', () => {
  const { doc, run } = page('<p>gone</p><p>stays</p>');
  const [gone, stays] = doc.querySelectorAll('p');
  want(gone, 'Loading');
  want(stays, 'Saving');
  gone.remove();
  run();
  assert.equal(said(doc), 'Saving');
});

test('want(): two elements and two copies wanting one label in one window say it once', () => {
  const { doc, queue, run } = page('<p>a</p><p>b</p>');
  const [a, b] = doc.querySelectorAll('p');
  want(a, 'Loading');
  copy.want(b, 'Loading');
  assert.equal(queue.size, 1, 'one window between the copies');
  const writes = [];
  const region = () => doc.querySelector('[data-vera-announce]');
  const seen = new doc.defaultView.MutationObserver((records) => records.forEach(() => writes.push(region()?.textContent)));
  run();
  seen.observe(region(), { childList: true, characterData: true, subtree: true });
  run();
  seen.disconnect();
  assert.equal(said(doc), 'Loading');
  assert.equal(regions(doc).length, 1);
});

test('release() twice is harmless, and a release after the window changes nothing', () => {
  const { doc, run } = page('<p>x</p>');
  const wanted = want(doc.querySelector('p'), 'Loading');
  run();
  wanted.release();
  wanted.release();
  assert.equal(said(doc), 'Loading');
});

test('jsdom has no :modal, so the body region serves and nothing throws', () => {
  const { doc, run } = page('<dialog open><button>in dialog</button></dialog>');
  announce(doc.querySelector('button'), 'From a dialog');
  run();
  assert.equal(regions(doc)[0].parentNode, doc.body);
});
