/**
 * `<H …>` and `<h1 …>` must mean the same thing — tested as the promise is written, in the DOM.
 *
 * `@verajs/renderer/tag` says it in its own source: *"React's names, mapped the way `@verajs/jsx`
 * maps them on a written element — so `<H1 className="t" disabled={d}>` and `<h1 className="t"
 * disabled={d}>` mean the same thing."* A tag used in JSX arrives as a COMPONENT CALL, so the
 * compiler passes its props through raw and the runtime is the only thing that can honour that.
 *
 * **Why this suite exists beside `./jsx-name-mapping.test.mjs`.** That one drives `jsxName` against
 * a table of NAMES. It passed for the entire life of three defects, because the divergences that
 * matter are not name-level: `ref` was accepted into the attribute sink and wrote the FUNCTION'S
 * OWN SOURCE TEXT into the DOM; `key` became a literal attribute and cost the list its identity;
 * and `dangerouslySetInnerHTML` needs its VALUE unwrapped, which no name table can do. It also
 * blessed the gap outright, asserting `jsxName('onClick') === 'onClick'` — true, and harmless only
 * because `spread` happens to be a third home for that rule.
 *
 * So this drives the AUTHORED spelling instead: both forms compiled from real JSX, both rendered,
 * and the resulting DOM and side effects compared. That is the level the drift lives at. The lesson
 * is paid for twice over — `./jsx-equivalence.test.mjs` was found to have written the
 * self-closing defect into BOTH halves of five of its own pairs, so it compared a bug with itself.
 *
 * Development-only: production folds the diagnostics one case asserts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node',
  'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MouseEvent'])
  globalThis[key] = key === 'window' ? dom.window : dom.window[key];

const { transformJsx } = await load('jsx');
const { renderer } = await load('renderer');
const core = await load('core');
core.wire([renderer]);
const { renderInto } = await load('renderer/hydrate');
const { keyed } = await load('renderer/keyed');
const { spread } = await load('renderer/spread');
const { tag } = await load('renderer/tag');

const H = tag`h1`;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(resolve));

/** Compiles one JSX expression to a function of `(s, H, f)` — real compilation, not a stand-in. */
const build = (source) => {
  const code = transformJsx(`const view = (s, H, f) => (${source});`, 'case.jsx', { inject: false });
  return new Function('html', 'keyed', 'spread', `${code}\nreturn view;`)(core.html, keyed, spread);
};

/**
 * Every case is ONE prop, written both ways. `differs` marks a divergence that is DELIBERATE, with
 * the reason — the list is short on purpose and every entry is a decision somebody made, not a
 * defect nobody got to.
 */
const PROPS = [
  ['className={s.str}', null], ['htmlFor={s.str}', null],
  ['value={s.str}', null], ['checked={s.yes}', null],
  ['defaultValue="dv"', null], ['defaultChecked={s.yes}', null],
  ['disabled={s.yes}', null], ['hidden={s.yes}', null], ['readonly={s.yes}', null],
  ['required={s.yes}', null], ['open={s.yes}', null], ['selected={s.yes}', null],
  ['multiple={s.yes}', null], ['autofocus={s.yes}', null], ['autoplay={s.yes}', null],
  ['controls={s.yes}', null], ['loop={s.yes}', null], ['muted={s.yes}', null],
  ['playsinline={s.yes}', null], ['inert={s.yes}', null], ['reversed={s.yes}', null],
  ['disabled={false}', null], ['hidden={s.no}', null],
  ['id="x"', null], ['title={s.str}', null], ['data-x={s.str}', null], ['aria-label={s.str}', null],
  ['.someProp={s.str}', null], ['?custom={s.yes}', null], ['@click={f}', null],
  ['onClick={f}', null], ['onPointerDown={f}', null],
  ['ref={f}', null],
  [
    'dangerouslySetInnerHTML={{ __html: s.str }}',
    'a tag binds through `spread`, which REFUSES `.innerHTML` by design — its names arrive at ' +
      'runtime, which is what makes that sink unreviewable. The element form is the supported one.',
  ],
];

const render = (source, container) => {
  const state = { str: 'v', yes: true, no: false };
  renderInto(build(source)(state, H, () => {}), container);
};

test('every prop means the same thing on <H …> as on <h1 …>', async () => {
  const diverged = [];
  let compared = 0;
  for (const [prop, expectedDifference] of PROPS) {
    const left = dom.window.document.createElement('div');
    const right = dom.window.document.createElement('div');
    dom.window.document.body.append(left, right);
    render(`<h1 ${prop}>x</h1>`, left);
    render(`<H ${prop}>x</H>`, right);
    await frame();

    const element = (host) => {
      const node = host.querySelector('h1');
      if (!node) return '(no element)';
      /**
       * Attributes, the two PROPERTY bindings, and the text — deliberately not `outerHTML`.
       * `children` is a binding on the component path and a static on the element path, so the
       * renderer's marker comments land differently and every case reads as a divergence. The
       * markers are the renderer's bookkeeping; the promise is about what the element IS.
       */
      const attributes = [...node.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
      return [
        ...attributes,
        `.value=${JSON.stringify(node.value ?? null)}`,
        `.checked=${JSON.stringify(node.checked ?? null)}`,
        `text=${JSON.stringify(node.textContent)}`,
      ].join(' ');
    };
    const same = element(left) === element(right);
    compared++;
    if (!same && expectedDifference === null) diverged.push(`${prop}\n    <h1>: ${element(left)}\n    <H> : ${element(right)}`);
    if (same && expectedDifference !== null)
      diverged.push(`${prop}\n    marked as a deliberate divergence, but the two now AGREE — delete the note`);
    left.remove();
    right.remove();
  }
  assert.equal(compared, PROPS.length, 'NON-ZERO CONTROL: every case must actually have been rendered');
  assert.deepEqual(diverged, [], `\n\n  ${diverged.length} prop(s) do not mean the same thing on both spellings:\n\n    ${diverged.join('\n\n    ')}\n`);
});

test('a ref fires on both spellings, with the element — not written into the DOM as text', async () => {
  const seen = {};
  for (const [name, source] of [['element', '<h1 ref={f}>x</h1>'], ['component', '<H ref={f}>x</H>']]) {
    const host = dom.window.document.createElement('div');
    dom.window.document.body.append(host);
    renderInto(build(source)({}, H, (element) => (seen[name] = element)), host);
    await frame();
    assert.doesNotMatch(host.innerHTML, /ref=/, `${name}: a ref must never reach the markup — under SSR that ships the closure's source to the client`);
    host.remove();
  }
  assert.equal(seen.element?.tagName, 'H1', 'NON-ZERO CONTROL: the element form must fire, or this suite measures nothing');
  assert.equal(seen.component?.tagName, 'H1', 'and the component form must fire the same way');
});

test('a key marks BOTH spellings for reconciliation, and reaches neither DOM', async () => {
  const ofElement = build('<h1 key={s.str}>x</h1>')({ str: 'k7' }, H, () => {});
  const ofComponent = build('<H key={s.str}>x</H>')({ str: 'k7' }, H, () => {});
  for (const [name, result] of [['element', ofElement], ['component', ofComponent]]) {
    assert.equal(result.key, 'k7', `${name}: the key must be stamped on the result`);
    assert.equal(typeof result.$r, 'function', `${name}: and the keyed strategy must travel with it`);
    const host = dom.window.document.createElement('div');
    dom.window.document.body.append(host);
    renderInto(result, host);
    await frame();
    assert.doesNotMatch(host.innerHTML, /key=/, `${name}: a key is the reconciler's, never an attribute`);
    host.remove();
  }
});

test('what a tag component cannot honour, it says out loud', { skip: isProduction && 'diagnostics are folded away' }, async () => {
  const real = console.warn;
  const warned = [];
  console.warn = (message) => warned.push(String(message));
  try {
    H({ key: 7 });
    H({ dangerouslySetInnerHTML: { __html: '<i>x</i>' } });
  } finally {
    console.warn = real;
  }
  assert.equal(warned.length, 2, 'NON-ZERO CONTROL: a silent run means the channel is gone, not that nothing was dropped');
  assert.match(warned[0], /`key` does nothing on a tag component/);
  assert.match(warned[1], /`dangerouslySetInnerHTML` is not available/);
  /** A refusal that does not name the alternative leaves the author exactly where they started. */
  assert.match(warned[0], /keyed\(id, Row/, 'the key warning names the working spelling');
  assert.match(warned[1], /\.innerHTML=/, 'the innerHTML warning names the working spelling');
});
