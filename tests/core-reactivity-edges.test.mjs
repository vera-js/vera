/**
 * Reactivity edges — the mutations that a Proxy does not report on its own.
 *
 * Found by auditing core against what a reactivity engine is expected to track. Two were genuinely
 * broken and had no coverage:
 *
 *   - **Appending to an array.** Assigning `list[3]` on a three-element array moves `length` as an
 *     internal consequence, without ever passing through the `set` trap for `length`. So a hook that
 *     read `length` was never told, and `push`/`unshift` were silently inert — while `splice`/`pop`
 *     worked, because those assign `length` explicitly. Silent staleness, not an error.
 *   - **Deleting a property.** The `deleteProperty` trap reported nothing at all, so a hook reading
 *     that property kept the value it last saw forever.
 *
 * The precision cases matter as much as the fixes: a hook reading only `list[0]` must NOT wake for
 * an append, or the fix has traded a missed update for a spurious one.
 */
import { load } from './dist.mjs';
import { JSDOM } from 'jsdom';

const core = await load('core');
const dom = new JSDOM('<body></body>');
globalThis.HTMLElement = dom.window.HTMLElement;

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => ok ? pass++ : (fail++, console.log('FAIL:', name, extra));

/** A hook on an attached element, driven once so its reads are tracked. */
const watch = (initial, read) => {
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  const state = core.createStore(initial);
  const seen = { runs: 0, value: undefined };
  core.createHook({
    element: host,
    priority: 60,
    callback: () => { seen.runs++; seen.value = read(state); },
  });
  [...host._hooks[0]][0](undefined, true);
  return { state, seen, from: seen.runs };
};

const notifies = (name, initial, read, mutate, expected) => {
  const { state, seen, from } = watch(initial, read);
  mutate(state);
  check(name, seen.runs > from, `never notified (value is ${JSON.stringify(read(state))})`);
  if (expected !== undefined) check(`${name} — hook saw the new value`, seen.value === expected,
    `saw ${JSON.stringify(seen.value)}, expected ${JSON.stringify(expected)}`);
};

const silent = (name, initial, read, mutate) => {
  const { state, seen, from } = watch(initial, read);
  mutate(state);
  check(name, seen.runs === from, 'notified when it should not have');
};

/* ── appending to an array moves length ─────────────────────────────────────────────────────── */
notifies('push notifies length', { l: [1, 2, 3] }, (s) => s.l.length, (s) => s.l.push(4), 4);
notifies('unshift notifies length', { l: [1, 2, 3] }, (s) => s.l.length, (s) => s.l.unshift(0), 4);
notifies('an index past the end notifies length', { l: [1, 2, 3] }, (s) => s.l.length, (s) => { s.l[5] = 9; }, 6);

/* ── the methods that already worked, so the fix cannot regress them ────────────────────────── */
notifies('splice still notifies length', { l: [1, 2, 3] }, (s) => s.l.length, (s) => s.l.splice(0, 1), 2);
notifies('pop still notifies length', { l: [1, 2, 3] }, (s) => s.l.length, (s) => s.l.pop(), 2);
notifies('an explicit length write notifies', { l: [1, 2, 3] }, (s) => s.l.length, (s) => { s.l.length = 1; }, 1);
notifies('an index within length notifies', { l: [1, 2, 3] }, (s) => s.l[0], (s) => { s.l[0] = 9; }, 9);

/* ── precision: an append must not wake a reader that never read length ─────────────────────── */
silent('push does not wake an index-only reader', { l: [1, 2, 3] }, (s) => s.l[0], (s) => s.l.push(9));
silent('a non-index key is not treated as growth', { l: [1, 2, 3] }, (s) => s.l.length, (s) => { s.l.tag = 'x'; });

/* ── delete ─────────────────────────────────────────────────────────────────────────────────── */
notifies('delete notifies with undefined', { n: 1 }, (s) => s.n, (s) => { delete s.n; }, undefined);
silent('deleting an absent property is silent', { n: 1 }, (s) => s.n, (s) => { delete s.missing; });
silent('deleting an unread property is silent', { n: 1, other: 2 }, (s) => s.n, (s) => { delete s.other; });

/* ── ordinary writes, unchanged ─────────────────────────────────────────────────────────────── */
notifies('a plain property write notifies', { n: 1 }, (s) => s.n, (s) => { s.n = 2; }, 2);
notifies('a property added later notifies its reader', {}, (s) => s.later, (s) => { s.later = 1; }, 1);
silent('writing the same value is silent', { n: 1 }, (s) => s.n, (s) => { s.n = 1; });

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
