/**
 * `@verajs/renderer/spread` — `<div ${spread(props)}>`, bindings whose names are not known at parse time.
 *
 * Tests the BUILT artifacts, development and production (see `./dist.mjs`).
 *
 * Two behaviours carry most of the weight here, because they are the two that a naive
 * implementation gets wrong and that nothing else in the suite would catch:
 *
 *   - **Ownership.** State is keyed by the renderer's element-position *part*, not by the element.
 *     Keyed by element, `<div ${spread(a)} ${spread(b)}>` shares one map and whichever applies
 *     second releases the other's keys. That was measured, not hypothesised — the first spread's
 *     attributes silently vanished.
 *   - **Release.** A key that disappears restores what the element held *before* the binding, rather
 *     than guessing at a value that means "absent". For a property there is no such value:
 *     `undefined` runs through coercing setters and `delete` cannot remove a prototype accessor.
 *     This is the question Lit's spread PR has been stuck on since 2021.
 */
import { load, isProduction } from './dist.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'Event',
                 'requestAnimationFrame', 'DocumentFragment', 'Text', 'Comment'])
  globalThis[k] = dom.window[k];

const { renderInto } = await load('renderer');
const { spread } = await load('renderer/spread');

/** The shape core's built-in `html` tag produces, as the other renderer suites do it. */
const html = (strings, ...values) => ({ _$litType$: 1, strings, values });

let host;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
});
const click = (el) => el.dispatchEvent(new dom.window.Event('click'));

/* ── the four binding kinds ──────────────────────────────────────────────────────────────────── */

test('plain keys become attributes', () => {
  renderInto(html`<input ${spread({ id: 'a', placeholder: 'type' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  assert.equal(el.getAttribute('placeholder'), 'type');
});

test('`.name` sets a property, not an attribute', () => {
  renderInto(html`<input ${spread({ '.value': 'typed' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.value, 'typed');
  assert.equal(el.getAttribute('value'), null, 'a property binding writes no attribute');
});

test('`?name` toggles a boolean attribute', () => {
  renderInto(html`<input ${spread({ '?disabled': true, '?readonly': false })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.hasAttribute('disabled'), true);
  assert.equal(el.hasAttribute('readonly'), false, 'a false boolean is absent, not empty');
});

test('`@name` and `onName` both bind events', () => {
  let sigil = 0;
  let react = 0;
  renderInto(html`<button ${spread({ '@click': () => sigil++ })}></button>
              <a ${spread({ onClick: () => react++ })}></a>`, host);
  click(host.querySelector('button'));
  click(host.querySelector('a'));
  assert.equal(sigil, 1);
  assert.equal(react, 1, 'onClick is accepted as @click, matching written bindings');
});

test('an object with handleEvent listens, as the platform allows', () => {
  /**
   * `addEventListener` takes two shapes, and the written `@event` binding was taught the second in
   * the event-lifecycle pass while this module kept calling `.call()` unconditionally — so the same
   * value fired through `@click` and threw `this._handler.call is not a function` on every dispatch
   * through a spread. Counted as fires, not as "did not throw": jsdom reports a listener's throw to
   * the virtual console rather than rethrowing, so a throw here reads as zero fires.
   */
  let fired = 0;
  renderInto(html`<button ${spread({ onClick: { handleEvent: () => fired++ } })}></button>`, host);
  click(host.querySelector('button'));
  assert.equal(fired, 1, 'the object bound but never listened');
});

test('all-lowercase `onclick` stays a plain attribute', () => {
  /** Legal inline-handler HTML; the same rule the renderer applies to written names. */
  renderInto(html`<button ${spread({ onclick: 'noop()' })}></button>`, host);
  assert.equal(host.querySelector('button').getAttribute('onclick'), 'noop()');
});

test('a null attribute value removes the attribute', () => {
  const draw = (v) => renderInto(html`<input ${spread({ id: v })} />`, host);
  draw('a');
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  draw(null);
  assert.equal(el.getAttribute('id'), null);
});

/* ── living alongside written bindings ───────────────────────────────────────────────────────── */

test('written attributes on the same element survive', () => {
  renderInto(html`<input class="base" ${spread({ id: 'a' })} />`, host);
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('class'), 'base');
  assert.equal(el.getAttribute('id'), 'a');
});

test('a spread key overrides a written attribute of the same name', () => {
  renderInto(html`<input type="text" ${spread({ type: 'number' })} />`, host);
  assert.equal(host.querySelector('input').getAttribute('type'), 'number');
});

test('element refs at the same position still work', () => {
  const seen = { value: null };
  renderInto(html`<span ${seen}></span>`, host);
  assert.equal(seen.value?.tagName, 'SPAN', 'a plain object is still a ref, not a props bag');
});

/* ── updates ─────────────────────────────────────────────────────────────────────────────────── */

test('values update in place across renders', () => {
  const draw = (id) => renderInto(html`<input ${spread({ id })} />`, host);
  draw('a');
  const el = host.querySelector('input');
  draw('b');
  assert.equal(el.getAttribute('id'), 'b');
  assert.equal(host.querySelector('input'), el, 'the element was updated, not replaced');
});

test('a handler swaps without re-registering the listener', () => {
  let a = 0;
  let b = 0;
  const draw = (fn) => renderInto(html`<button ${spread({ onClick: fn })}></button>`, host);
  draw(() => a++);
  const el = host.querySelector('button');
  draw(() => b++);
  click(el);
  assert.equal(a, 0, 'the old handler no longer fires');
  assert.equal(b, 1);
});

/* ── ownership: several spreads on one element ───────────────────────────────────────────────── */

test('two spreads on one element do not release each other', () => {
  const draw = () => renderInto(html`<input ${spread({ id: 'a' })} ${spread({ title: 'b' })} />`, host);
  draw();
  draw(); // the second render is where element-keyed state would have collided
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('id'), 'a');
  assert.equal(el.getAttribute('title'), 'b');
});

/* ── release: restore what was there ─────────────────────────────────────────────────────────── */

test('a dropped attribute key restores the written value, not nothing', () => {
  const draw = (p) => renderInto(html`<input type="text" ${spread(p)} />`, host);
  draw({ type: 'number' });
  const el = host.querySelector('input');
  assert.equal(el.getAttribute('type'), 'number');
  draw({});
  assert.equal(el.getAttribute('type'), 'text', 'released to the initial state, not removed');
});

test('a dropped attribute with no initial value is removed', () => {
  const draw = (p) => renderInto(html`<input ${spread(p)} />`, host);
  draw({ id: 'a' });
  const el = host.querySelector('input');
  draw({});
  assert.equal(el.getAttribute('id'), null);
});

test('a dropped boolean restores its written state', () => {
  const draw = (p) => renderInto(html`<input disabled ${spread(p)} />`, host);
  draw({ '?disabled': false });
  const el = host.querySelector('input');
  assert.equal(el.hasAttribute('disabled'), false);
  draw({});
  assert.equal(el.hasAttribute('disabled'), true);
});

test('a dropped property on a custom element restores to undefined, not ""', () => {
  /**
   * The case that makes "restore what was there" the right question. Assigning `undefined` would
   * be indistinguishable here, but for `input.value` it coerces to `""` — one rule covers both.
   */
  customElements.define('x-spread-bag', class extends HTMLElement {});
  const draw = (p) => renderInto(html`<x-spread-bag ${spread(p)}></x-spread-bag>`, host);
  draw({ '.items': [1, 2] });
  const el = host.querySelector('x-spread-bag');
  assert.deepEqual(el.items, [1, 2]);
  draw({});
  assert.equal(el.items, undefined);
});

test('a dropped event key stops the handler firing', () => {
  let n = 0;
  const draw = (p) => renderInto(html`<button ${spread(p)}></button>`, host);
  draw({ onClick: () => n++ });
  const el = host.querySelector('button');
  click(el);
  draw({});
  click(el);
  assert.equal(n, 1, 'fired once while bound, never after release');
});

test('a key removed and re-added binds again', () => {
  const draw = (p) => renderInto(html`<input ${spread(p)} />`, host);
  draw({ id: 'a' });
  const el = host.querySelector('input');
  draw({});
  draw({ id: 'c' });
  assert.equal(el.getAttribute('id'), 'c');
});

/* ── shape churn ─────────────────────────────────────────────────────────────────────────────── */

test('adding and removing keys in the same render is handled', () => {
  /** Equal sizes with different members — the case a naive size check alone would miss. */
  const draw = (p) => renderInto(html`<input ${spread(p)} />`, host);
  draw({ id: 'a', title: 't' });
  const el = host.querySelector('input');
  draw({ id: 'a', lang: 'en' });
  assert.equal(el.getAttribute('lang'), 'en');
  assert.equal(el.getAttribute('title'), null, 'the departed key was released despite equal counts');
  assert.equal(el.getAttribute('id'), 'a');
});

test('an empty props object is valid and releases everything', () => {
  const draw = (p) => renderInto(html`<input ${spread(p)} />`, host);
  draw({ id: 'a', title: 't' });
  const el = host.querySelector('input');
  draw({});
  assert.equal(el.getAttribute('id'), null);
  assert.equal(el.getAttribute('title'), null);
});

/* ── a key that cannot be written into markup ────────────────────────────────────────────────── */
/**
 * A spread's keys are runtime data — that is what the module is for — so the set of names it may be
 * handed is not under the author's control the way a template's statics are.
 *
 * `setAttribute` refuses some of these by throwing `InvalidCharacterError`, which took down the
 * whole render for one bad key in a props bag. Others it accepts (`"`, `'`, `<` were measured as
 * accepted in Chromium) but markup cannot carry them, and `@verajs/ssr` therefore refuses them — so
 * a key that worked here and vanished server-side would be worse than one that works nowhere. Both
 * sides apply the same rule and skip.
 */
test('an unusable key is skipped rather than thrown, and its neighbours still apply', () => {
  /** A fresh container per case: the renderer keeps its parts keyed by the one it rendered into. */
  const into = () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    return container;
  };
  for (const key of [
    'x><script>alert(1)</script',
    'x onmouseover=alert(1) y',
    'x" onload="alert(1)',
    "x' onload='alert(1)",
    'a b',
    'a/b',
    'a=b',
    'a`b',
    'a<b',
    '',
  ]) {
    const container = into();
    renderInto(html`<b ${spread({ [key]: '1', title: 'kept' })}>x</b>`, container);
    const element = container.querySelector('b');
    assert.equal(element.getAttribute('title'), 'kept', `a good key beside ${JSON.stringify(key)}`);
    assert.equal(element.attributes.length, 1, `only the good key survived ${JSON.stringify(key)}`);
  }
});

/**
 * A name that is legal but happens to be a regular-expression metacharacter — `a|b`, `a*b`, `a?b` —
 * lives in `tests/browser/spread-names.test.js` instead. **jsdom rejects those names and every real
 * engine accepts them**: measured across Chromium, Firefox and WebKit, `setAttribute` refuses only
 * whitespace, `>`, `=` and `/`, while jsdom enforces the strict XML Name production. Asserting the
 * browsers' behaviour here would test jsdom's parser and fail.
 *
 * The server side of the same names — where interpolating one into a `RegExp` made `a|title` an
 * alternation that removed an attribute it never named — is covered in
 * `tests/ssr-spread-equivalence.test.mjs`.
 */

/* ── the ref sigil ───────────────────────────────────────────────────────────────────────────── */
/**
 * `&name` is the written form's element ref (`<input &field=${myRef} />`), and it was the one
 * written binding kind a spread could not express: the key fell through to a plain attribute, so
 * this threw and the server wrote `&field="[object Object]"` into the markup.
 */
test('a &ref key hands the element to a function or an object', () => {
  const seen = [];
  const box = { value: null };
  renderInto(html`<b ${spread({ '&fn': (element) => seen.push(element.localName), '&box': box })}>x</b>`, host);
  const el = host.querySelector('b');
  assert.deepEqual(seen, ['b']);
  assert.equal(box.value, el);
  assert.equal(el.attributes.length, 0, 'a ref is not an attribute');
});

/* ── a live key ──────────────────────────────────────────────────────────────────────────────── */
/**
 * `!name` through a spread must mean what the written binding means — the invariant
 * `tests/ssr-spread-equivalence.test.mjs` enforces on the server, asserted here on the client.
 */
test('a !live key reasserts against the DOM, and a .property key does not', () => {
  /** One call site per case: two template literals are two templates, and the second would rebuild
   *  the element rather than update it. */
  const drawLive = (into) => renderInto(html`<input ${spread({ '!value': 'Ada' })} />`, into);
  const drawPlain = (into) => renderInto(html`<input ${spread({ '.value': 'Ada' })} />`, into);

  const liveContainer = document.createElement('div');
  document.body.appendChild(liveContainer);
  drawLive(liveContainer);
  const live = liveContainer.querySelector('input');
  live.value = 'Grace';
  drawLive(liveContainer);
  assert.equal(live.value, 'Ada', 'the live key wrote again');

  const plainContainer = document.createElement('div');
  document.body.appendChild(plainContainer);
  drawPlain(plainContainer);
  const plain = plainContainer.querySelector('input');
  plain.value = 'Grace';
  drawPlain(plainContainer);
  assert.equal(plain.value, 'Grace', 'the plain key kept the typed text');
});

/**
 * **A props bag that is not an object was iterated anyway, and a browser accepted the result.**
 *
 * Everything in this module reads `props` with `Object.keys`/`Object.entries`, which answer for any
 * value. A **string** yields its character indices, so `spread('text')` set four attributes named
 * `0`, `1`, `2`, `3` — measured in Chromium, with no error and no warning. Everything else yielded
 * nothing, so `spread(somethingUndefined)` applied no props and said nothing, which reads as a
 * renderer that ignored the spread rather than a value that was wrong.
 *
 * **jsdom hid this instead of catching it**, which is why the case was confirmed in a browser before
 * being called a defect. jsdom implements the XML Name production and throws `InvalidCharacterError`
 * on `setAttribute('0', …)`, so the one input a real engine handles *silently* is the one input a
 * jsdom probe reports loudly. That is the usual jsdom warning in `CLAUDE.md` running backwards: it
 * is stricter than the platform, so its strictness can conceal a defect as easily as invent one.
 * `tests/browser/spread-names.test.js` holds the engines' real rule.
 *
 * Warned and ignored rather than thrown — exactly what an unusable *key* already does, since one bad
 * props bag should not cost the render.
 */
test('a props bag that is not a plain object is refused, not iterated', { skip: isProduction && 'the guard is __DEV__' }, () => {
  for (const value of ['text', 42, true, null, undefined, ['a', 'b'], () => {}]) {
    const said = [];
    const warn = console.warn;
    console.warn = (...args) => said.push(args.join(' '));
    const host = dom.window.document.createElement('div');
    renderInto(html`<input ${spread(value)} />`, host);
    console.warn = warn;

    const names = [...host.querySelector('input').attributes].map((a) => a.name);
    assert.deepEqual(names, [], `spread(${String(value)}) must apply nothing`);
    assert.equal(said.length, 1, `spread(${String(value)}) must say so`);
    assert.match(said[0], /^\[vera\] spread: ignoring a props bag/);
  }
});

test('a real props bag is still quiet', { skip: isProduction && 'the guard is __DEV__' }, () => {
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  const host = dom.window.document.createElement('div');
  renderInto(html`<input ${spread({ id: 'ok' })} />`, host);
  console.warn = warn;
  assert.deepEqual(said, [], 'a plain object must not warn');
  assert.equal(host.querySelector('input').getAttribute('id'), 'ok');
});

/**
 * **A guard that changes behaviour has to exist in both builds.**
 *
 * The refusal and its warning were both inside `if (__DEV__)`, so a bad props bag applied nothing in
 * development and was iterated by character index in production — `spread('text')` giving an element
 * attributes named `0`, `1`, `2` and `3`. The divergence ran in the direction that hides the bug: the
 * app under test looked fine and only the shipped one was wrong.
 *
 * This suite runs against both artifacts (`tests/dist.mjs`), so asserting the *behaviour* here is
 * what pins it — the warning is still development-only and is asserted separately.
 */
test('a props bag that is not a plain object applies nothing, in either build', () => {
  const original = console.warn;
  console.warn = () => {};
  try {
    for (const bad of ['text', 42, ['a'], null, undefined, true, Symbol('s')]) {
      const host = document.createElement('div');
      renderInto(html`<p ${spread(bad)}></p>`, host);
      const element = host.querySelector('p');
      assert.ok(element, `spread(${String(bad)}) lost the element entirely`);
      assert.deepEqual(
        [...element.attributes].map((a) => a.name),
        [],
        `spread(${String(bad)}) applied attributes; a string is iterated by character index`
      );
    }
  } finally {
    console.warn = original;
  }
});
