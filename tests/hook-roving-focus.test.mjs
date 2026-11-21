/**
 * **`@vera-hooks/roving-focus`: one tab stop per group, moved by the arrows, Home and End.** Each row is one line of the
 * sign-off sheet (the surface, and principles 1, 2, 5, 6, 8, 10, 11, 12), or one point of its review.
 *
 * jsdom is the regression net here, never the oracle: real key presses, Tab order and axe live in the browser suite.
 * These rows hold what the hook decides and writes, which is our code. jsdom answers `:dir(ltr)` wrongly inside a
 * `dir=rtl` subtree and `:dir(rtl)` rightly, so the hook reads only `:dir(rtl)`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';
import { extendSeeds } from './fuzz-seeds.mjs';

const GLOBALS = ['window', 'document', 'HTMLElement', 'Node', 'Element', 'DocumentFragment', 'ShadowRoot', 'Event', 'KeyboardEvent', 'MutationObserver'];

/** A fresh document holding `markup`, with the globals pointed at it. */
const page = (markup) => {
  const dom = new JSDOM(`<!doctype html><body>${markup}</body>`, { url: 'http://localhost/' });
  for (const key of GLOBALS) globalThis[key] = dom.window[key];
  return dom.window.document;
};

/** Every console.warn while `run` runs. */
const warnings = (run) => {
  const said = [];
  const { warn } = console;
  console.warn = (...args) => said.push(String(args[0]));
  try {
    run();
  } finally {
    console.warn = warn;
  }
  return said;
};

/** Presses `key` on the focused element; returns whether the hook took it (`preventDefault`). */
const press = (doc, key, mods = {}) => {
  const event = new doc.defaultView.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true, ...mods });
  (doc.activeElement ?? doc.body).dispatchEvent(event);
  return event.defaultPrevented;
};

/** Each item's tabindex, `null` where it has none. */
const stops = (items) => items.map((item) => item.getAttribute('tabindex'));

const { rovingFocus } = await load('vera-hooks/roving-focus');
const { nextIndex } = await load('vera-hooks/roving-focus/internal');

// ---- the pure move -------------------------------------------------------------------------------------------------

const all = () => true;
const except = (...gone) => (i) => !gone.includes(i);
const H = { orientation: 'horizontal', rtl: false, wrap: true };
const axis = (over) => ({ ...H, ...over });

test('nextIndex: Right and Left step, and wrap by default', () => {
  assert.equal(nextIndex(3, 0, 'ArrowRight', H, all), 1);
  assert.equal(nextIndex(3, 2, 'ArrowRight', H, all), 0);
  assert.equal(nextIndex(3, 0, 'ArrowLeft', H, all), 2);
});

test('nextIndex: right to left swaps Left and Right, and NEVER Up and Down', () => {
  assert.equal(nextIndex(3, 0, 'ArrowLeft', axis({ rtl: true }), all), 1);
  assert.equal(nextIndex(3, 1, 'ArrowRight', axis({ rtl: true }), all), 0);
  for (const orientation of ['vertical', 'both']) {
    assert.equal(nextIndex(3, 0, 'ArrowDown', axis({ orientation, rtl: true }), all), 1, orientation);
    assert.equal(nextIndex(3, 1, 'ArrowUp', axis({ orientation, rtl: true }), all), 0, orientation);
  }
});

test('nextIndex: a key across the orientation is not ours (null); both takes all four; other keys are never ours', () => {
  assert.equal(nextIndex(3, 0, 'ArrowDown', H, all), null);
  assert.equal(nextIndex(3, 0, 'ArrowRight', axis({ orientation: 'vertical' }), all), null);
  assert.equal(nextIndex(3, 0, 'ArrowDown', axis({ orientation: 'both' }), all), 1);
  assert.equal(nextIndex(3, 0, 'ArrowRight', axis({ orientation: 'both' }), all), 1);
  for (const key of ['Tab', 'Enter', ' ', 'a', 'PageDown', 'Escape']) assert.equal(nextIndex(3, 0, key, axis({ orientation: 'both' }), all), null, key);
});

test('nextIndex: without wrap an end stays put, handled (the same index)', () => {
  assert.equal(nextIndex(3, 2, 'ArrowRight', axis({ wrap: false }), all), 2);
  assert.equal(nextIndex(3, 0, 'ArrowLeft', axis({ wrap: false }), all), 0);
});

test('nextIndex: Home and End go to the first and last REACHABLE item, wrap or not', () => {
  assert.equal(nextIndex(4, 2, 'Home', axis({ wrap: false }), except(0)), 1);
  assert.equal(nextIndex(4, 1, 'End', axis({ orientation: 'vertical' }), except(3)), 2);
});

test('nextIndex: skipped items are stepped over in both directions and across the wrap', () => {
  assert.equal(nextIndex(5, 0, 'ArrowRight', H, except(1, 2)), 3);
  assert.equal(nextIndex(5, 0, 'ArrowLeft', H, except(4)), 3);
  assert.equal(nextIndex(5, 3, 'ArrowRight', H, except(4, 0)), 1);
});

test('nextIndex: with the focused item gone, an arrow either way moves to the FIRST reachable item; End to the last', () => {
  assert.equal(nextIndex(3, -1, 'ArrowLeft', H, except(0)), 1);
  assert.equal(nextIndex(3, 7, 'ArrowRight', H, all), 0);
  assert.equal(nextIndex(3, -1, 'End', H, all), 2);
});

test('nextIndex: one reachable item stays put (handled, the walk ends); none gives -1; no items gives -1', () => {
  assert.equal(nextIndex(1, 0, 'ArrowRight', H, all), 0);
  assert.equal(nextIndex(3, 1, 'ArrowRight', H, except(0, 2)), 1);
  assert.equal(nextIndex(3, 1, 'ArrowRight', H, () => false), -1);
  for (const key of ['ArrowRight', 'Home', 'End']) assert.equal(nextIndex(0, -1, key, H, all), -1, key);
});

/** The model, written another way: positions in the list of reachable indices, not a scan. */
const model = (count, index, key, { orientation, rtl, wrap }, reachable) => {
  const h = orientation !== 'vertical';
  const v = orientation !== 'horizontal';
  const dir =
    key === 'Home' || key === 'End' ? key
    : h && key === 'ArrowRight' ? (rtl ? -1 : 1)
    : h && key === 'ArrowLeft' ? (rtl ? 1 : -1)
    : v && key === 'ArrowDown' ? 1
    : v && key === 'ArrowUp' ? -1
    : null;
  if (dir === null) return null;
  const live = [...Array(count).keys()].filter(reachable);
  if (!live.length) return -1;
  if (dir === 'Home') return live[0];
  if (dir === 'End') return live.at(-1);
  if (index < 0 || index >= count) return live[0];
  const ahead = live.filter((i) => (dir > 0 ? i > index : i < index));
  if (ahead.length) return dir > 0 ? ahead[0] : ahead.at(-1);
  const other = wrap ? live.filter((i) => i !== index) : [];
  if (other.length) return dir > 0 ? other[0] : other.at(-1);
  return reachable(index) ? index : -1;
};

test('nextIndex: seeded fuzz, 20 000 random states per seed agree with the model, which must move often', () => {
  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab', 'x'];
  const ORIENTATIONS = ['horizontal', 'vertical', 'both'];
  for (const base of extendSeeds([0x5eed, 7, 1234567])) {
    let seed = base >>> 0;
    const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    let moved = 0;
    for (let n = 0; n < 20000; n++) {
      const count = Math.floor(rand() * 7);
      const mask = Array.from({ length: count }, () => rand() < 0.7);
      const reachable = (i) => mask[i];
      const index = Math.floor(rand() * (count + 2)) - 1;
      const key = KEYS[Math.floor(rand() * KEYS.length)];
      const ax = { orientation: ORIENTATIONS[Math.floor(rand() * 3)], rtl: rand() < 0.5, wrap: rand() < 0.5 };
      const want = model(count, index, key, ax, reachable);
      assert.equal(nextIndex(count, index, key, ax, reachable), want, `seed ${base}: ${JSON.stringify({ count, index, key, ax, mask })}`);
      if (want !== null && want !== index && want !== -1) moved++;
    }
    assert.ok(moved > 5000, `seed ${base}: the fuzz moved only ${moved} times, so it is not exercising the function`);
  }
});

// ---- the hook ------------------------------------------------------------------------------------------------------

const TOOLBAR = '<div id="g"><button>a</button><button>b</button><button>c</button></div>';
const group = (doc) => [...doc.querySelector('#g').children];

test('wiring: the first reachable item is the one tab stop; release puts back every tabindex, absent and user-set', () => {
  const doc = page('<div id="g"><button>a</button><button tabindex="3">b</button><span tabindex="0">c</span></div>');
  const items = group(doc);
  const roving = rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  assert.deepEqual(stops(items), ['0', '-1', '-1']);
  roving.release();
  assert.deepEqual(stops(items), [null, '3', '0']);
  roving.release();
  assert.deepEqual(stops(items), [null, '3', '0'], 'release is idempotent');
});

test('an arrow moves focus and the tab stop, is taken (preventDefault), and calls onMove with the item', () => {
  const doc = page(TOOLBAR);
  const items = group(doc);
  const moved = [];
  rovingFocus(doc.querySelector('#g'), { items: () => items, onMove: (item) => moved.push(item), orientation: 'horizontal' });
  items[0].focus();
  assert.equal(press(doc, 'ArrowRight'), true);
  assert.equal(doc.activeElement, items[1]);
  assert.deepEqual(stops(items), ['-1', '0', '-1']);
  assert.deepEqual(moved, [items[1]]);
  assert.equal(press(doc, 'End'), true);
  assert.equal(doc.activeElement, items[2]);
});

test('Alt, Ctrl or Meta held: the key is the platform\'s (no move, no preventDefault); unmodified is the control', () => {
  const doc = page(TOOLBAR);
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  items[0].focus();
  for (const mod of ['altKey', 'ctrlKey', 'metaKey']) {
    assert.equal(press(doc, 'ArrowRight', { [mod]: true }), false, mod);
    assert.equal(doc.activeElement, items[0], mod);
  }
  assert.equal(press(doc, 'ArrowRight'), true, 'CONTROL: the same key unmodified is taken');
});

test('Tab, Enter and Space are never taken', () => {
  const doc = page(TOOLBAR);
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'both' });
  items[0].focus();
  for (const key of ['Tab', 'Enter', ' ']) assert.equal(press(doc, key), false, key);
});

test('right to left (dir on an ancestor): Left moves forward, read at the key, so a later dir change is followed', () => {
  const doc = page(`<section dir="rtl">${TOOLBAR}</section>`);
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  items[0].focus();
  press(doc, 'ArrowLeft');
  assert.equal(doc.activeElement, items[1]);
  doc.querySelector('section').dir = 'ltr';
  press(doc, 'ArrowLeft');
  assert.equal(doc.activeElement, items[0], 'never cached');
});

test('vertical: Right and Left are not taken; Down moves', () => {
  const doc = page(TOOLBAR);
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'vertical' });
  items[0].focus();
  assert.equal(press(doc, 'ArrowRight'), false);
  assert.equal(press(doc, 'ArrowDown'), true);
  assert.equal(doc.activeElement, items[1]);
});

test('default skip: a :disabled item is passed over and an aria-disabled one stays reachable (APG)', () => {
  const doc = page('<div id="g"><button>a</button><button disabled>b</button><button aria-disabled="true">c</button></div>');
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  items[0].focus();
  press(doc, 'ArrowRight');
  assert.equal(doc.activeElement, items[2]);
});

test('skip is read on every key: an item disabled after wiring is passed over from then on', () => {
  const doc = page('<div id="g"><button>a</button><button>b</button><button>c</button><button>d</button></div>');
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, wrap: false, orientation: 'horizontal' });
  items[1].focus();
  items[2].disabled = true;
  press(doc, 'ArrowRight');
  assert.equal(doc.activeElement, items[3]);
});

test('focus arriving by pointer or script (focusin) makes that item the one tab stop', () => {
  const doc = page(TOOLBAR);
  const items = group(doc);
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  items[2].focus();
  assert.deepEqual(stops(items), ['-1', '-1', '0']);
});

test('an item added after wiring: focusin or refresh() gives it -1, so the group keeps exactly ONE tab stop', () => {
  const doc = page(TOOLBAR);
  const container = doc.querySelector('#g');
  const items = () => [...container.children];
  const roving = rovingFocus(container, { items, orientation: 'horizontal' });
  const late = container.appendChild(doc.createElement('button'));
  assert.equal(late.getAttribute('tabindex'), null, 'CONTROL: the stray stop exists before the repair');
  roving.refresh();
  assert.deepEqual(stops(items()), ['0', '-1', '-1', '-1']);
  const later = container.appendChild(doc.createElement('button'));
  items()[1].focus();
  assert.equal(later.getAttribute('tabindex'), '-1', 'focusin repairs it too');
  assert.equal(stops(items()).filter((s) => s === '0').length, 1);
});

test('an item that leaves the group gets its own tabindex back at the next sync, and release does not touch it again', () => {
  const doc = page('<div id="g"><button>a</button><button tabindex="5">b</button><button>c</button></div><button id="out">o</button>');
  const container = doc.querySelector('#g');
  const items = () => [...container.children];
  const roving = rovingFocus(container, { items, orientation: 'horizontal' });
  const b = items()[1];
  doc.body.appendChild(b);
  roving.refresh();
  assert.equal(b.getAttribute('tabindex'), '5');
  b.setAttribute('tabindex', '9');
  roving.release();
  assert.equal(b.getAttribute('tabindex'), '9');
});

test('the active item removed: the next key moves to the first reachable item', () => {
  const doc = page(TOOLBAR);
  const container = doc.querySelector('#g');
  const items = () => [...container.children];
  rovingFocus(container, { items, orientation: 'horizontal' });
  items()[2].focus();
  items()[0].remove();
  press(doc, 'ArrowRight');
  assert.equal(doc.activeElement, items()[0], 'wrapped from the last to the first');
  assert.deepEqual(stops(items()), ['0', '-1']);
});

test('nested groups: an inner item\'s keys and focus never move the outer group; the outer group still works', () => {
  const doc = page('<div id="outer"><button>o1</button><div id="inner"><button>i1</button><button>i2</button></div><button>o2</button></div>');
  const outer = doc.querySelector('#outer');
  const inner = doc.querySelector('#inner');
  const outerItems = [outer.children[0], inner, outer.children[2]];
  const innerItems = [...inner.children];
  inner.tabIndex = -1;
  rovingFocus(outer, { items: () => outerItems, orientation: 'horizontal' });
  rovingFocus(inner, { items: () => innerItems, orientation: 'horizontal' });
  innerItems[1].focus();
  assert.deepEqual(stops(outerItems), ['0', '-1', '-1'], 'focusin from an inner item leaves the outer tab stop');
  press(doc, 'ArrowRight');
  assert.equal(doc.activeElement, innerItems[0], 'the inner group wrapped');
  assert.deepEqual(stops(outerItems), ['0', '-1', '-1'], 'and the outer did not move');
  outerItems[0].focus();
  press(doc, 'ArrowRight');
  assert.equal(doc.activeElement, inner, 'CONTROL: the outer group moves on its own items');
});

test('a group inside a user\'s open shadow root works (the focused element is read through composedPath)', () => {
  const doc = page('<div id="host"></div>');
  const root = doc.querySelector('#host').attachShadow({ mode: 'open' });
  root.innerHTML = TOOLBAR;
  const items = [...root.querySelector('#g').children];
  rovingFocus(root.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  items[0].focus();
  const event = new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true, composed: true });
  items[0].dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(root.activeElement, items[1]);
});

test('released: keys and focus do nothing (both listeners gone); a live group beside it is the control', () => {
  const doc = page(`${TOOLBAR}<div id="h"><button>x</button><button>y</button></div>`);
  const items = group(doc);
  const live = [...doc.querySelector('#h').children];
  rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' }).release();
  rovingFocus(doc.querySelector('#h'), { items: () => live, orientation: 'horizontal' });
  items[2].focus();
  assert.equal(press(doc, 'ArrowRight'), false);
  assert.deepEqual(stops(items), [null, null, null]);
  live[0].focus();
  assert.equal(press(doc, 'ArrowRight'), true, 'CONTROL');
});

test('focus(item) moves the tab stop; a foreign or skipped item is a no-op that warns in development', () => {
  const doc = page(`${TOOLBAR}<button id="out">o</button>`);
  const items = group(doc);
  items[1].disabled = true;
  const roving = rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
  roving.focus(items[2]);
  assert.equal(doc.activeElement, items[2]);
  const said = warnings(() => {
    roving.focus(doc.querySelector('#out'));
    roving.focus(items[1]);
  });
  assert.equal(doc.activeElement, items[2]);
  assert.equal(said.length, isProduction ? 0 : 2);
  if (!isProduction) for (const line of said) assert.match(line, /roving-focus-foreign/);
});

test('no reachable item: development warns once, not on every key, and again only after one became reachable', () => {
  const doc = page('<div id="g"><button disabled>a</button><button disabled>b</button></div>');
  const items = group(doc);
  let roving;
  const said = warnings(() => {
    roving = rovingFocus(doc.querySelector('#g'), { items: () => items, orientation: 'horizontal' });
    roving.refresh();
    roving.refresh();
  });
  assert.equal(said.length, isProduction ? 0 : 1);
  if (!isProduction) assert.match(said[0], /roving-focus-none/);
  items[0].disabled = false;
  roving.refresh();
  assert.deepEqual(stops(items), ['0', '-1']);
  items[0].disabled = true;
  assert.equal(warnings(() => roving.refresh()).length, isProduction ? 0 : 1, 're-armed');
});

test('safe by construction: across a seeded key sequence the hook writes only tabindex (a planted write is caught)', async () => {
  const doc = page('<div id="g"><button>a</button><button disabled>b</button><button aria-disabled="true">c</button><button>d</button></div>');
  const container = doc.querySelector('#g');
  const items = group(doc);
  const seen = new Set();
  const observer = new doc.defaultView.MutationObserver((records) => {
    for (const record of records) seen.add(record.type === 'attributes' ? record.attributeName : record.type);
  });
  observer.observe(container, { attributes: true, childList: true, characterData: true, subtree: true });
  rovingFocus(container, { items: () => items, orientation: 'both' });
  items[0].focus();
  let seed = 99;
  const KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
  for (let n = 0; n < 200; n++) press(doc, KEYS[(seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) % KEYS.length]);
  await Promise.resolve();
  assert.deepEqual([...seen], ['tabindex']);
  items[3].setAttribute('data-planted', '');
  await Promise.resolve();
  assert.ok(seen.has('data-planted'), 'CONTROL: the observer sees a write that is not tabindex');
  observer.disconnect();
});
