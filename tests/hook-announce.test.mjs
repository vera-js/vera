/**
 * **`@vera-hooks/announce`: one live region per document, and the settle window a spinner speaks through.** Each row
 * is one line of the sign-off sheet (the surface, and principles 1, 2, 5, 6, 8, 10, 11, 12) or one point of its reviews.
 *
 * jsdom is the regression net, never the oracle: whether a screen reader SPEAKS a write, and modals (jsdom has no
 * `:modal`), live in the browser suite. These rows hold what the hook decides and writes. Its timers run on a clock the
 * row advances (`advance(ms)` runs every timer due by then, in due order), so every "said" and "said nothing" is read
 * after exactly the timers that would have said it, never after a sleep.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const GLOBALS = ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Event'];

/** A clock on `win`'s timers: `advance(ms)` runs every timer due within `ms`, in due order, including ones they queue. */
const clockOn = (win) => {
  const queue = new Map();
  let now = 0;
  let next = 0;
  win.setTimeout = (fn, ms = 0) => (queue.set(++next, { fn, at: now + ms, ms }), next);
  win.clearTimeout = (id) => void queue.delete(id);
  const advance = (ms) => {
    const until = now + ms;
    for (;;) {
      let first = null;
      for (const [id, timer] of queue) if (timer.at <= until && (first === null || timer.at < first[1].at)) first = [id, timer];
      if (first === null) break;
      queue.delete(first[0]);
      now = first[1].at;
      first[1].fn();
    }
    now = until;
  };
  return { queue, advance };
};

/** A fresh document, the globals pointed at it, and its window's timers on a clock this row drives. */
const page = (markup = '') => {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { url: 'http://localhost/' });
  for (const key of GLOBALS) globalThis[key] = dom.window[key];
  const win = dom.window;
  const { queue, advance } = clockOn(win);
  /** Past every write and the settle window, short of a message's removal. */
  const run = () => advance(1000);
  return { doc: win.document, win, queue, advance, run };
};

const regions = (doc) => [...doc.querySelectorAll('[data-vera-announce]')];
/** The messages a region holds, in order; null when there is no region. */
const said = (doc, politeness = 'polite') => {
  const region = doc.querySelector(`[data-vera-announce="${politeness}"]`);
  return region === null ? null : [...region.children].map((message) => message.textContent);
};

const { announce, want } = await load('vera-hooks/announce');
/** A second copy of the hook: its own module instance, as a page with two bundles has. */
const copy = await load('vera-hooks/announce', '?second-copy');

test('a polite announcement: one hidden region on body, the message added a moment later', () => {
  const { doc, run } = page('<button>b</button>');
  announce(doc.querySelector('button'), 'Saved');
  assert.equal(regions(doc).length, 1);
  assert.equal(regions(doc)[0].parentNode, doc.body);
  assert.deepEqual(said(doc), [], 'nothing added yet');
  run();
  assert.deepEqual(said(doc), ['Saved']);
});

test("the region's attributes: aria-live, aria-relevant additions, and hidden without leaving the accessibility tree", () => {
  const { doc, run } = page('<p>x</p>');
  announce(doc.querySelector('p'), 'Hi');
  run();
  const [region] = regions(doc);
  assert.deepEqual(region.getAttributeNames().sort(), ['aria-live', 'aria-relevant', 'data-vera-announce', 'style'], 'no role, nothing else');
  assert.equal(region.getAttribute('aria-live'), 'polite');
  assert.equal(region.getAttribute('aria-relevant'), 'additions');
  assert.notEqual(region.style.display, 'none', 'display: none would silence it');
  assert.notEqual(region.style.visibility, 'hidden', 'so would visibility: hidden');
  assert.equal(region.style.clipPath, 'inset(50%)');
});

test('the same text twice is two messages, so it is heard twice', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'Copied');
  run();
  announce(p, 'Copied');
  run();
  assert.deepEqual(said(doc), ['Copied', 'Copied']);
});

test('two different messages in one moment, with no key, are both said, in order (review D1)', () => {
  const { doc, advance } = page('<p>a</p><p>b</p>');
  const [a, b] = doc.querySelectorAll('p');
  announce(a, 'Saved');
  advance(10);
  announce(b, '3 results');
  advance(1000);
  assert.deepEqual(said(doc), ['Saved', '3 results']);
});

test('the first message into a new region waits longer than the next ones (a region written as it is inserted is not spoken)', () => {
  const { doc, queue, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'one');
  const first = [...queue.values()][0].ms;
  run();
  announce(p, 'two');
  const later = [...queue.values()].find((timer) => timer.ms < 1000).ms;
  run();
  assert.ok(first > later, `first ${first} ms, later ${later} ms`);
});

test('a region made at write time (body emptied after the call) waits its first-write delay again (review D2)', () => {
  const { doc, advance } = page('<p>x</p>');
  announce(doc.querySelector('p'), 'late');
  doc.body.innerHTML = '<p>y</p>';
  advance(100);
  assert.equal(regions(doc).length, 1, 'the write made a new region');
  assert.deepEqual(said(doc), [], 'and did not write into it at once');
  advance(100);
  assert.deepEqual(said(doc), ['late']);
});

test('a spoken message is removed after a while; the region stays', () => {
  const { doc, advance } = page('<p>x</p>');
  announce(doc.querySelector('p'), 'Saved');
  advance(1000);
  assert.deepEqual(said(doc), ['Saved']);
  advance(7000);
  assert.deepEqual(said(doc), []);
  assert.equal(regions(doc).length, 1);
});

test('a removal takes only its own message: a newer one stays, and the region still speaks additions only', () => {
  const { doc, advance } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'older');
  advance(1000);
  announce(p, 'newer');
  advance(6500);
  assert.deepEqual(said(doc), ['newer'], 'the older one removed at its 7 s, the newer one kept');
  assert.equal(regions(doc)[0].getAttribute('aria-relevant'), 'additions', 'a removal is not spoken');
  advance(1000);
  assert.deepEqual(said(doc), []);
});

test('assertive gets its own region, made only when asked', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'polite one');
  run();
  assert.equal(said(doc, 'assertive'), null, 'no assertive region until asked');
  announce(p, 'Card declined', { politeness: 'assertive' });
  run();
  assert.deepEqual(said(doc, 'assertive'), ['Card declined']);
  assert.deepEqual(said(doc), ['polite one'], 'the polite region kept its own');
  assert.equal(regions(doc).length, 2);
});

test('a key collapses announcements within one moment to the last', () => {
  const { doc, queue, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, '3 characters left', { key: 'count' });
  announce(p, '2 characters left', { key: 'count' });
  announce(p, '1 character left', { key: 'count' });
  assert.equal(queue.size, 1, 'one write pending');
  /** Every ADDITION is spoken, so the count is of nodes added, not of what the region holds at the end. */
  const observer = new doc.defaultView.MutationObserver(() => {});
  observer.observe(doc.body, { childList: true, subtree: true });
  run();
  const added = observer
    .takeRecords()
    .flatMap((record) => [...record.addedNodes])
    .map((node) => node.textContent)
    .filter((text) => text.includes('character'));
  observer.disconnect();
  assert.deepEqual(said(doc), ['1 character left']);
  assert.deepEqual(added, ['1 character left'], 'only the last was ever added');
});

test("keyed writes 200 ms apart leave one node: each replaces its key's earlier message", () => {
  const { doc, advance } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'other');
  advance(200);
  for (const text of ['3 left', '2 left', '1 left']) {
    announce(p, text, { key: 'count' });
    advance(200);
  }
  assert.deepEqual(said(doc), ['other', '1 left'], 'one node for the key, an unkeyed message untouched');
  advance(7000);
  assert.deepEqual(said(doc), []);
  announce(p, '0 left', { key: 'count' });
  advance(200);
  assert.deepEqual(said(doc), ['0 left'], 'a key whose message was removed writes afresh');
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
  assert.deepEqual(said(doc), ['from the first', 'from the second']);
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
  assert.deepEqual(said(doc), ['after']);
});

test('an element in a user shadow root speaks through its document region', () => {
  const { doc, run } = page('<div id="host"></div>');
  const root = doc.querySelector('#host').attachShadow({ mode: 'open' });
  root.innerHTML = '<button>in shadow</button>';
  announce(root.querySelector('button'), 'From the shadow');
  run();
  assert.equal(root.querySelectorAll('[data-vera-announce]').length, 0, 'no region inside the shadow root');
  assert.deepEqual(said(doc), ['From the shadow']);
});

test('an iframe has its own region, in its own document', () => {
  const { doc } = page('<p>x</p><iframe></iframe>');
  const inner = doc.querySelector('iframe').contentDocument;
  inner.body.innerHTML = '<p>in</p>';
  const { advance } = clockOn(inner.defaultView);
  announce(inner.querySelector('p'), 'Inside');
  advance(1000);
  assert.deepEqual(said(inner), ['Inside']);
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
  want(p, 'Loading').release();
});

test('a hidden tab queues nothing: an announcement nobody is there to hear is stale by their return', () => {
  const { doc, queue } = page('<p>x</p>');
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  announce(doc.querySelector('p'), 'unheard');
  assert.equal(queue.size, 0);
  assert.equal(regions(doc).length, 0);
});

test('a tab hidden when the write comes drops what was waiting, and a later message after its return is said alone', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'stale');
  Object.defineProperty(doc, 'visibilityState', { value: 'hidden', configurable: true });
  run();
  assert.deepEqual(said(doc), [], 'nothing written while hidden');
  Object.defineProperty(doc, 'visibilityState', { value: 'visible', configurable: true });
  announce(p, 'fresh');
  run();
  assert.deepEqual(said(doc), ['fresh'], 'the dropped message does not come back');
});

test('messages are said in call order across a first write and a key (review D1, by queue)', () => {
  const { doc, advance } = page('<p>x</p>');
  const p = doc.querySelector('p');
  announce(p, 'one');
  advance(10);
  announce(p, 'count 3', { key: 'count' });
  advance(10);
  announce(p, 'two');
  announce(p, 'count 2', { key: 'count' });
  advance(1000);
  assert.deepEqual(said(doc), ['one', 'two', 'count 2'], 'the key replaced its waiting message; the latest goes last');
});

test('a hostile string is text: no element is made from it', () => {
  const { doc, run } = page('<p>x</p>');
  const hostile = '<img src=x onerror="globalThis.ran=1"><script>globalThis.ran=1</script>';
  announce(doc.querySelector('p'), hostile);
  run();
  const [message] = regions(doc)[0].children;
  assert.equal(message.textContent, hostile);
  assert.equal(message.children.length, 0);
});

test('a failure other than an unknown :modal is not read as "no modal" (review A3)', () => {
  const { doc } = page('<p>x</p>');
  const real = doc.querySelectorAll.bind(doc);
  doc.querySelectorAll = (selector) => {
    if (selector === ':modal') throw new TypeError('a real failure');
    return real(selector);
  };
  assert.throws(() => announce(doc.querySelector('p'), 'x'), /a real failure/);
});

test('jsdom has no :modal (a SyntaxError), so the body region serves and nothing throws', () => {
  const { doc, run } = page('<dialog open><button>in dialog</button></dialog>');
  assert.throws(() => doc.querySelectorAll(':modal'), (error) => error.name === 'SyntaxError', 'CONTROL: jsdom refuses :modal');
  announce(doc.querySelector('button'), 'From a dialog');
  run();
  assert.equal(regions(doc)[0].parentNode, doc.body);
});

test('want(): a label still wanted when the window closes is said once', () => {
  const { doc, queue, run } = page('<p>x</p>');
  want(doc.querySelector('p'), 'Loading');
  assert.equal(queue.size, 1, 'the window');
  assert.equal(regions(doc).length, 0, 'nothing before the window closes');
  run();
  assert.deepEqual(said(doc), ['Loading']);
});

test('want(): released inside the window, it says nothing (a fast load is silent)', () => {
  const { doc, run } = page('<p>x</p>');
  const p = doc.querySelector('p');
  want(p, 'Loading').release();
  /** CONTROL in the same window: another label is said, so the window did close and speak. */
  want(p, 'Saving');
  run();
  assert.deepEqual(said(doc), ['Saving']);
});

test('want(): an element that left the document inside the window says nothing', () => {
  const { doc, run } = page('<p>gone</p><p>stays</p>');
  const [gone, stays] = doc.querySelectorAll('p');
  want(gone, 'Loading');
  want(stays, 'Saving');
  gone.remove();
  run();
  assert.deepEqual(said(doc), ['Saving']);
});

test('want(): two elements and two copies wanting one label in one window say it once', () => {
  const { doc, queue, run } = page('<p>a</p><p>b</p>');
  const [a, b] = doc.querySelectorAll('p');
  want(a, 'Loading');
  copy.want(b, 'Loading');
  assert.equal(queue.size, 1, 'one window between the copies');
  run();
  assert.deepEqual(said(doc), ['Loading']);
  assert.equal(regions(doc).length, 1);
});

test('release() twice is harmless, and a release after the window changes nothing', () => {
  const { doc, run } = page('<p>x</p>');
  const wanted = want(doc.querySelector('p'), 'Loading');
  run();
  wanted.release();
  wanted.release();
  assert.deepEqual(said(doc), ['Loading']);
});
