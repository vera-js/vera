/**
 * `_$child$` — a value at a child position that applies itself.
 *
 * The same idea as `_$apply$` at element position, which is how `@verajs/renderer/spread` ships as
 * a package the renderer knows nothing about. This is the other position worth extending, and the
 * point of it is that a third party can write `until()`, a portal or a virtualizer without the
 * framework growing a directive system: no base class, no factory, no lifecycle — a directive is an
 * object carrying a hoisted applier.
 *
 * Everything below is written the way a *consumer* would write it, against nothing but the public
 * protocol, because that is the claim being tested.
 *
 * Tests BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { load, isProduction } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;

const { renderInto } = await load('renderer');
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });
const into = () => {
  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  return container;
};
const read = (container) => container.innerHTML.replace(/<!---->/g, '');

/**
 * The applier is **hoisted**, and that is the contract: its identity is the directive's identity,
 * so the part knows whose `previous` it is holding. An applier written as an object-literal method
 * is a new function per call and would never see its own state — the same reason `spread` hoists
 * `_$apply$`.
 */
function applyUntil(part, previous) {
  if (previous && previous.promise === this.promise) return previous;
  if (previous) previous.live = false;
  const state = { promise: this.promise, live: true };
  part._$commit$(this.placeholder);
  this.promise.then((value) => {
    if (state.live) part._$commit$(value);
  });
  return state;
}
const until = (promise, placeholder) => ({ _$child$: applyUntil, promise, placeholder });

/** Commits once now (nothing) and once when its promise settles — after the render that attached it returned. */
function applyLater(part, previous) {
  if (previous) return previous;
  part._$commit$(null);
  this.promise.then((value) => part._$commit$(value));
  return {};
}
const later = (promise) => ({ _$child$: applyLater, promise });

test('a late commit runs as a render of its container — a <select> it renders shows its value', async () => {
  const container = into();
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  renderInto(html`<div>${later(promise)}</div>`, container);
  resolve(html`<select .value=${'b'}><option value="a">A</option><option value="b">B</option></select>`);
  await promise;
  await Promise.resolve();
  assert.equal(container.querySelector('select').value, 'b', 'the queued value was applied by the late commit itself');
});

test('a directive renders, keeps its place across renders, and updates asynchronously', async () => {
  const container = into();
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  const draw = () => renderInto(html`<p>${until(promise, html`<em>loading…</em>`)}</p>`, container);

  draw();
  assert.equal(read(container), '<p><em>loading…</em></p>');

  draw();
  assert.equal(read(container), '<p><em>loading…</em></p>', 'a re-render must not restart it');

  resolve(html`<b>done</b>`);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(read(container), '<p><b>done</b></p>');

  draw();
  assert.equal(read(container), '<p><b>done</b></p>', 'and the resolved value survives a re-render');
});

test('a part goes back to an ordinary value afterwards', async () => {
  const container = into();
  const promise = Promise.resolve(html`<b>done</b>`);
  const draw = (value) => renderInto(html`<p>${value}</p>`, container);
  draw(until(promise, html`<em>…</em>`));
  await Promise.resolve();
  await Promise.resolve();
  draw('plain text');
  assert.equal(read(container), '<p>plain text</p>');
});

/**
 * Continuity belongs to the directive that created it. Two different appliers landing on one part
 * across renders must not read each other's state — which would hand one directive another's
 * internals and is the failure mode a shared slot invites.
 */
test('two directives at one part do not share state', () => {
  const seen = [];
  function first(part, previous) {
    seen.push(['first', previous]);
    part._$commit$('one');
    return 'first-state';
  }
  function second(part, previous) {
    seen.push(['second', previous]);
    part._$commit$('two');
    return 'second-state';
  }
  const container = into();
  const draw = (applier) => renderInto(html`<p>${{ _$child$: applier }}</p>`, container);

  draw(first);
  draw(second);
  draw(first);

  assert.deepEqual(seen, [
    ['first', undefined],
    ['second', undefined],
    ['first', undefined],
  ], 'each applier saw only its own history, and none survived the other');
  assert.equal(read(container), '<p>one</p>');
});

test('a directive keeps its state across its own commits, and loses it when the part is cleared', () => {
  const seen = [];
  function counting(part, previous) {
    seen.push(previous);
    part._$commit$(`n=${(previous ?? 0) + 1}`);
    return (previous ?? 0) + 1;
  }
  const container = into();
  const draw = (value) => renderInto(html`<p>${value}</p>`, container);
  const directive = { _$child$: counting };

  draw(directive);
  draw(directive);
  draw(directive);
  assert.deepEqual(seen, [undefined, 1, 2], 'its own rendering did not destroy its continuity');
  assert.equal(read(container), '<p>n=3</p>');

  /** Something else took the part over: the directive's assumptions no longer hold. */
  draw(html`<i>other</i>`);
  draw(directive);
  assert.equal(seen[3], undefined, 'and an external clear reset it');
});

/**
 * The protocol must not disturb what a child position already accepts — the matrices in
 * `render-parity` and `render-update-parity` cover the values themselves; this is the ordering.
 * A template is the common object at a child position and returns before the check is ever read,
 * which is why the check costs the hot path nothing.
 */
test('ordinary child values are unaffected', () => {
  const container = into();
  const draw = (value) => renderInto(html`<p>${value}</p>`, container);
  draw(html`<i>t</i>`);
  assert.equal(read(container), '<p><i>t</i></p>');
  draw(['a', 'b']);
  assert.equal(read(container), '<p>ab</p>');
  const node = dom.window.document.createElement('span');
  draw(node);
  assert.equal(container.querySelector('span'), node);
  draw({ toString: () => 'stringified' });
  assert.equal(read(container), '<p>stringified</p>');
});

/**
 * A bound `<select>` re-asserts its value on every render — its options can be replaced under an unchanged
 * value — but only WRITES when the value it holds differs: the write resets every option's selectedness, and
 * paying it per row per render made a table with a select per row several times slower. Counted, not timed.
 */
test('an unchanged <select> value is not written again; replaced options still get it', () => {
  const host = document.createElement('div');
  const proto = Object.getPrototypeOf(document.createElement('select'));
  const desc = Object.getOwnPropertyDescriptor(proto, 'value');
  let writes = 0;
  Object.defineProperty(proto, 'value', { ...desc, set(v) { writes++; desc.set.call(this, v); } });
  try {
    const option = (o) => html`<option value=${o}>${o}</option>`;
    const draw = (opts) => renderInto(html`<select .value=${'b'}>${opts.map(option)}</select>`, host);
    draw(['a', 'b', 'c']);
    const first = writes;
    assert.equal(host.querySelector('select').value, 'b');
    draw(['a', 'b', 'c']);
    draw(['a', 'b', 'c']);
    assert.equal(writes, first, 'no write while the select already holds its value');
    draw(['x', 'b']);
    assert.equal(host.querySelector('select').value, 'b', 'replaced options still end with the bound value selected');
  } finally {
    Object.defineProperty(proto, 'value', desc);
  }
});

/**
 * `.value` and `.selectedIndex` on a `<select multiple>` read and set a SINGLE selection and do not control the rest —
 * always writing to make it controlled cost 2–3% on every select-per-row table. Development says so, naming the
 * property actually bound, for a template and a spread key alike (one rule, `isSelection`, decides both).
 */
test('a selection binding on a <select multiple> is named in development — template and spread', { skip: isProduction && 'diagnostics are folded away' }, async () => {
  const { spread } = await load('renderer/spread');
  const said = [];
  const warn = console.warn;
  console.warn = (m) => said.push(String(m));
  try {
    for (const t of [
      html`<select multiple .value=${'a'}><option value="a">a</option></select>`,
      html`<select multiple .selectedIndex=${0}><option value="a">a</option></select>`,
      html`<select multiple ${spread({ '!value': 'a' })}><option value="a">a</option></select>`,
    ])
      renderInto(t, document.createElement('div'));
  } finally {
    console.warn = warn;
  }
  const ours = said.filter((m) => m.endsWith('(select-multiple)'));
  assert.equal(ours.length, 3, `one line per binding, by code: ${said.join('\n')}`);
  /** The area is the module the user wired: a template binding says `renderer:`, a spread key `spread:`. */
  assert.match(ours[0], /^\[vera\] renderer: <select multiple> — `value` controls only ONE selection/);
  assert.match(ours[1], /^\[vera\] renderer: <select multiple> — `selectedIndex` controls only ONE selection/);
  assert.match(ours[2], /^\[vera\] spread: <select multiple> — `value` controls only ONE selection/);
});

/**
 * **A `<select>`'s own bindings commit after its content — every spelling, every applier.** In document order a
 * binding ON the select comes before its options, so everything but a template `.value` used to write before the
 * options existed and fell back to the first. The options' source varies too: a list, a nested template, a keyed list.
 */
test('a select gets its selection whatever spells it and wherever its options come from', async () => {
  const { spread } = await load('renderer/spread');
  const { keyed } = await load('renderer/keyed');
  const option = (o) => html`<option value=${o}>${o}</option>`;
  const sources = {
    'a list': () => ['a', 'b', 'c'].map(option),
    'a nested template': () => html`<option value="a">a</option><option value="b">b</option>`,
    'a keyed list': () => ['a', 'b'].map((o) => keyed(o, option(o))),
  };
  const spellings = {
    '.value': (opts) => html`<select .value=${'b'}>${opts}</select>`,
    '!value': (opts) => html`<select !value=${'b'}>${opts}</select>`,
    ".selectedIndex": (opts) => html`<select .selectedIndex=${1}>${opts}</select>`,
    "spread({ '.value' })": (opts) => html`<select ${spread({ '.value': 'b' })}>${opts}</select>`,
    "spread({ '!value' })": (opts) => html`<select ${spread({ '!value': 'b' })}>${opts}</select>`,
  };
  const wrong = [];
  for (const [source, opts] of Object.entries(sources))
    for (const [spelling, build] of Object.entries(spellings)) {
      const host = document.createElement('div');
      renderInto(build(opts()), host);
      const got = host.querySelector('select').value;
      if (got !== 'b') wrong.push(`${spelling} from ${source}: ${JSON.stringify(got)}`);
    }
  assert.deepEqual(wrong, []);
});

/**
 * **A select's binding is re-asserted on every update — every spelling, `.` and `!` alike, written or spread** — because
 * its options can move under an unchanged value, and only the binding says which one should now be selected.
 *
 * - By value, over an unkeyed list: `b` moves from second to third, so the option element that WAS selected now
 *   holds `y`, and a binding skipped as unchanged leaves `y` showing.
 * - By index, over a keyed list: an option is prepended, so the selected ELEMENT moves to index 2, keeping its
 *   selectedness, while the binding still says 1.
 */
test('a select binding is re-asserted when its options move under it — every spelling', async () => {
  const { spread } = await load('renderer/spread');
  const { keyed } = await load('renderer/keyed');
  const plain = (opts) => opts.map((o) => html`<option value=${o}>${o}</option>`);
  const keyedOpts = (opts) => opts.map((o) => keyed(o, html`<option value=${o}>${o}</option>`));
  const cases = [
    ...[
      ['.value', (o) => html`<select .value=${'b'}>${o}</select>`],
      ['!value', (o) => html`<select !value=${'b'}>${o}</select>`],
      ["spread({ '.value' })", (o) => html`<select ${spread({ '.value': 'b' })}>${o}</select>`],
      ["spread({ '!value' })", (o) => html`<select ${spread({ '!value': 'b' })}>${o}</select>`],
    ].map(([spelling, draw]) => ({ spelling, draw, options: plain, before: ['a', 'b'], after: ['x', 'y', 'b'], read: (el) => el.value, want: 'b' })),
    ...[
      ['.selectedIndex', (o) => html`<select .selectedIndex=${1}>${o}</select>`],
      ['!selectedIndex', (o) => html`<select !selectedIndex=${1}>${o}</select>`],
      ["spread({ '.selectedIndex' })", (o) => html`<select ${spread({ '.selectedIndex': 1 })}>${o}</select>`],
      ["spread({ '!selectedIndex' })", (o) => html`<select ${spread({ '!selectedIndex': 1 })}>${o}</select>`],
    ].map(([spelling, draw]) => ({ spelling, draw, options: keyedOpts, before: ['a', 'b'], after: ['z', 'a', 'b'], read: (el) => el.selectedIndex, want: 1 })),
  ];
  const wrong = [];
  for (const { spelling, draw, options, before, after, read, want } of cases) {
    const host = document.createElement('div');
    /** One call site per spelling, so the second render UPDATES the first rather than replacing it. */
    renderInto(draw(options(before)), host);
    renderInto(draw(options(after)), host);
    const got = read(host.querySelector('select'));
    if (got !== want) wrong.push(`${spelling}: ${JSON.stringify(got)}`);
  }
  assert.deepEqual(wrong, []);
});

/**
 * **A render flushes only the bindings IT held.** A select's bindings wait for the end of their pass; a render nested
 * inside that pass — here an applier that renders into another container, between the select's binding and its
 * options — ends first, and must not commit the outer select early, before its options exist (it would fall back to
 * the first). (An applier's own `_$commit$` during its container's render is not a nested pass: it sets in place.)
 */
test("a render nested inside a pass does not commit its caller's select early", () => {
  /** Inside the select, AFTER its binding was held and BEFORE its options: the one place an early flush shows. */
  let ran = 0;
  const nested = { _$child$: () => { ran++; renderInto(html`<i></i>`, document.createElement('div')); } };
  const host = document.createElement('div');
  renderInto(html`<select .value=${'b'}>${nested}${[html`<option value="a">a</option>`, html`<option value="b">b</option>`]}</select>`, host);
  assert.equal(ran, 1, 'CONTROL: the nested render ran, inside the pass');
  assert.equal(host.querySelector('select').value, 'b');
});
