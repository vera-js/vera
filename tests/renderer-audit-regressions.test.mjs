/**
 * Regressions found in the 2026-08-25 full-framework audit, renderer half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment'])
  globalThis[key] = dom.window[key];

const { renderInto } = await load('renderer');
const { html, tag } = await load('renderer/tag');

/* ── a string can never become a tag ─────────────────────────────────────────────────────────── */

/**
 * The refusal is the security property this entry exists for — the set of tags an app can produce
 * is fixed by its source, so a tag can never come from a request. It lived only in `tag` itself,
 * which guards interpolation into a tag *literal*; reaching tag position through `html` produced no
 * error and no element, because the base scanner reads the expression as an element ref on a tag
 * with no name and the surrounding markup renders as escaped text.
 */
test('a string in tag position is refused, not silently mangled', { skip: isProduction && 'the guard is __DEV__' }, () => {
  assert.throws(() => html`<${'script'}>x</${'script'}>`, /cannot become markup/);
  assert.throws(() => html`<${'div'}></${'div'}>`, /Only a tag may be interpolated/);
  assert.throws(() => html`<${null}></${null}>`, /null cannot become markup/);
});

test('a tag in tag position still works, and updates in place', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const draw = (t, body) => html`<${t} class="x">${body}</${t}>`;
  renderInto(draw(tag`h1`, 'a'), host);
  assert.equal(host.querySelector('h1')?.textContent, 'a');
  const first = host.querySelector('h1');
  renderInto(draw(tag`h1`, 'b'), host);
  assert.equal(host.querySelector('h1'), first, 'same tag keeps the element');
  renderInto(draw(tag`h2`, 'c'), host);
  assert.equal(host.querySelector('h2')?.textContent, 'c', 'a different tag rebuilds');
});

/** A value elsewhere in the template must stay an ordinary binding. */
test('a non-tag value outside tag position is unaffected', () => {
  const host = document.createElement('div');
  document.body.append(host);
  renderInto(html`<p title=${'t'}>${'body'}</p>`, host);
  assert.equal(host.querySelector('p')?.getAttribute('title'), 't');
  assert.equal(host.querySelector('p')?.textContent, 'body');
});

/**
 * The base renderer cannot refuse it — `<${x}>` is a legal element-ref position as far as the
 * scanner is concerned — but it can say what the author almost certainly meant.
 */
test('the base renderer names the tag entry for an expression in tag position', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const core = await load('core');
  const errors = [];
  const nativeError = console.error;
  console.error = (...args) => errors.push(String(args[0]));
  try {
    /** The scan happens when the renderer first builds the template, not when `html` is called. */
    const host = document.createElement('div');
    document.body.append(host);
    renderInto(core.html`<${'div'}>x</${'div'}>`, host);
  } finally {
    console.error = nativeError;
  }
  assert.ok(
    errors.some((m) => m.includes('@verajs/renderer/tag')),
    'it must name the entry that does support runtime tag names'
  );
});

/* ── the un-hoisted child applier ────────────────────────────────────────────────────────────── */

/**
 * Writing `_$child$` as an object-literal method makes a new function per render, so the part never
 * recognises it, `previous` is `undefined` forever, and the directive silently restarts on every
 * pass. It is the first rule in the renderer README and it fails without a symptom — which is
 * exactly the kind of trap a framework should say out loud.
 */
test('an applier that changes identity every render is named', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const core = await load('core');
  const host = document.createElement('div');
  document.body.append(host);

  const warnings = [];
  const nativeWarn = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  try {
    /** The mistake: a fresh method object per call. */
    const badly = (label) => ({
      _$child$(part) {
        part._$commit$(label);
        return label;
      },
    });
    for (const label of ['a', 'b', 'c', 'd']) renderInto(core.html`<p>${badly(label)}</p>`, host);
  } finally {
    console.warn = nativeWarn;
  }

  assert.ok(
    warnings.some((m) => m.includes('Hoist the applier')),
    'it must name the fix, not just the symptom'
  );
  assert.equal(host.querySelector('p')?.textContent, 'd', 'and it still renders');
});

/** A hoisted applier keeps continuity and must never warn. */
test('a hoisted applier keeps its previous return and stays quiet', { skip: isProduction && 'the guard is __DEV__' }, async () => {
  const core = await load('core');
  const host = document.createElement('div');
  document.body.append(host);
  const seen = [];
  function applyThing(part, previous) {
    seen.push(previous);
    part._$commit$(this.label);
    return this.label;
  }
  const thing = (label) => ({ _$child$: applyThing, label });

  const warnings = [];
  const nativeWarn = console.warn;
  console.warn = (...args) => warnings.push(String(args[0]));
  try {
    for (const label of ['a', 'b', 'c', 'd']) renderInto(core.html`<p>${thing(label)}</p>`, host);
  } finally {
    console.warn = nativeWarn;
  }

  assert.deepEqual(seen, [undefined, 'a', 'b', 'c'], 'continuity holds across renders');
  assert.equal(warnings.filter((m) => m.includes('Hoist the applier')).length, 0);
});

/* ── an element ref is told when its element goes away ───────────────────────────────────────── */

/**
 * A ref was told about attachment and never about detachment, so it kept a detached node alive and
 * a component reading `myRef.value` after a subtree was replaced got the old element back. Lit
 * passes `undefined` for the same reason.
 *
 * The cost had to land on templates that actually contain a ref: `_clear`'s bulk removal is what
 * makes emptying a 1 000-row table ~5 ms against lit-html's ~22 ms, and walking parts on every
 * removal is the per-node work it exists to skip. The scan already knows which templates hold a
 * `&` part, so the walk is gated on that — measured, `clear 1k` is unchanged.
 */
test('a function ref is called with null when its element is torn down', async () => {
  const core = await load('core');
  const host = document.createElement('div');
  document.body.append(host);
  const seen = [];
  const draw = (show) =>
    show ? core.html`<p &=${(el) => seen.push(el === null ? null : el.tagName)}>a</p>` : core.html`<span>b</span>`;

  renderInto(draw(true), host);
  assert.deepEqual(seen, ['P'], 'attached');
  renderInto(draw(false), host);
  assert.deepEqual(seen, ['P', null], 'and released when the subtree was replaced');
});

test('an object ref has its value cleared', async () => {
  const core = await load('core');
  const host = document.createElement('div');
  document.body.append(host);
  const box = core.ref(null);
  const draw = (show) => (show ? core.html`<p &=${box}>a</p>` : core.html`<span>b</span>`);

  renderInto(draw(true), host);
  assert.equal(box.value?.tagName, 'P');
  renderInto(draw(false), host);
  assert.equal(box.value, null, 'null, not a detached element');
});

/** A self-applying value owns its own lifecycle and must not be written through. */
test('a spread object is not released', async () => {
  const core = await load('core');
  const { spread } = await load('renderer/spread');
  const host = document.createElement('div');
  document.body.append(host);
  const props = { a: '1' };
  const draw = (show) => (show ? core.html`<p ${spread(props)}>a</p>` : core.html`<span>b</span>`);

  renderInto(draw(true), host);
  renderInto(draw(false), host);
  assert.deepEqual(props, { a: '1' }, 'the spread object is untouched');
});

/** A template with no ref must not be walked at all — this pins the shape, not just the outcome. */
test('a template with no ref renders and clears normally', async () => {
  const core = await load('core');
  const host = document.createElement('div');
  document.body.append(host);
  const draw = (n) => core.html`<ul>${[0, 1, 2].map((i) => core.html`<li>${n + i}</li>`)}</ul>`;
  renderInto(draw(0), host);
  renderInto(draw(10), host);
  assert.equal(host.textContent, '101112');
});

/* ── an expression in attribute-name position ────────────────────────────────────────────────── */

/**
 * **The server refused this and the client shipped the garbage.**
 *
 * `<b ${name}="x">` is not a dynamic attribute name: the marker is not preceded by `=`, so it reads
 * as an element ref, and the `="x"` after it stays literal markup. The parser then makes
 * `<b ="x"="">` of it — attributes nobody wrote, silently. `<b data-${n}="1">` and `<b a${n}b="1">`
 * are the same mistake in the middle of a name.
 *
 * `@verajs/ssr`'s README already said this is *"malformed on both sides"* and the serializer threw
 * rather than emit it. The client did not, so a developer rendering only in a browser saw malformed
 * output with no clue, and adding SSR later turned it into a throw with no obvious connection to
 * what they had written.
 *
 * Found by a sweep putting expressions in every unusual template position.
 */
test('an expression in attribute-name position is reported', { skip: isProduction && 'the guard is __DEV__' }, () => {
  const said = [];
  const original = console.error;
  console.error = (...args) => said.push(args.join(' '));
  const complaints = (make) => {
    said.length = 0;
    renderInto(make(), dom.window.document.createElement('div'));
    return said.filter((line) => /attribute-name position/.test(line));
  };
  try {
    assert.equal(complaints(() => html`<b ${'title'}="x">y</b>`).length, 1, 'a whole name');
    assert.equal(complaints(() => html`<b data-${'x'}="1">y</b>`).length, 1, 'a name prefix');
    assert.equal(complaints(() => html`<b a${'x'}b="1">y</b>`).length, 1, 'a marker inside a name');

    const named = complaints(() => html`<b ${'title'}="x">y</b>`)[0];
    assert.match(named, /^\[vera\]/, 'carries the framework prefix');
    assert.match(named, /spread/, 'and names the entry that does support runtime names');

    /**
     * The controls matter more than the cases: an element ref is the *legitimate* reading of an
     * expression in this position, and a diagnostic that fired on every `ref` would be unusable.
     */
    assert.deepEqual(complaints(() => html`<b ${(e) => e}>y</b>`), [], 'a bare element ref');
    assert.deepEqual(complaints(() => html`<b ${(e) => e} class="c">y</b>`), [], 'a ref before an attribute');
    assert.deepEqual(complaints(() => html`<input ${(e) => e} />`), [], 'a ref in a self-closing element');
  } finally {
    console.error = original;
  }
});
