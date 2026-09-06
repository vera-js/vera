/**
 * The two published extension points nothing had ever *used* — only named.
 *
 * Pass 93's lens was mechanical: for every export of every published entry point, how many test
 * files name it? Everything was named at least once, which is a weaker bar than it looks — pass 92's
 * defect survived because `setRenderScheduler` was named in a misuse test while its actual scheduling
 * behaviour was never exercised. Narrowing to "named by at most one file" surfaced these.
 *
 * Both are extension APIs, which is the worst place for a coverage gap: breakage is invisible to us
 * and fatal to whoever is extending the framework, and they are the shapes we are least likely to
 * use ourselves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['document', 'HTMLElement', 'Node', 'Element', 'customElements', 'DocumentFragment',
                   'Text', 'Comment', 'CSSStyleSheet', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event'])
  globalThis[key] = dom.window[key];

const core = await load('core');
const { renderInto, renderer } = await load('renderer');
const reactivity = await load('reactivity');
core.wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * **`GLOBAL` is a literal contract across a package boundary**, which is why it is asserted here
 * rather than trusted. `@verajs/core` declares `'_global'` itself instead of importing it, because a
 * production bundle inlines its dependencies and an import would subscribe to one string while
 * notifying another — working in development and silently failing in production, which is the exact
 * hazard `wire`-from-core exists to prevent. Nothing checked the two literals still agree.
 */
test('GLOBAL is the literal core declares for itself', () => {
  assert.equal(reactivity.GLOBAL, '_global');
});

test('a collection insert built from the published exports tracks size and entries', async () => {
  let wrapperCalls = 0;
  /** The documented use: "wrap it to add a type, or read it as the reference". */
  core.wire({
    on: 'collection',
    fn: (obj, prop, propValue, addCallback, runCallbacks) => {
      wrapperCalls++;
      return reactivity.collectionMethod(obj, prop, propValue, addCallback, runCallbacks);
    },
    priority: 50,
  });

  const tag = 'x-extension-collection';
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() {
      core.init(this, { mode: 'open' });
      const state = core.createStore({ m: new Map([['a', 1]]) });
      this._state = state;
      core.render(() => core.html`<p>size:${state.m.size} a:${state.m.get('a')}</p>`);
    }
  });
  const element = dom.window.document.createElement(tag);
  dom.window.document.body.appendChild(element);
  await frame();

  assert.equal(element.shadowRoot.textContent, 'size:1 a:1');
  assert.ok(wrapperCalls > 0, 'the wrapping insert was never called, so this asserts nothing');

  /** A shape change notifies `GLOBAL`; if that literal ever diverges, `size` silently stops. */
  element._state.m.set('b', 2);
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:2 a:1', 'size did not track — check the GLOBAL contract');

  /** A per-entry change notifies the key, not the shape. */
  element._state.m.set('a', 9);
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:2 a:9', 'a per-entry change did not track');

  element._state.m.delete('b');
  await frame();
  assert.equal(element.shadowRoot.textContent, 'size:1 a:9', 'a delete did not update size');
});

/**
 * `veraJsx` is `@verajs/jsx`'s consumer-facing artifact — the whole of the documented build
 * integration is `plugins: [veraJsx()]` — and the only test naming it checked that the export
 * existed. The plugin was never run.
 */
test('the veraJsx bundler plugin transforms exactly the files it should', async () => {
  const { veraJsx } = await load('jsx');
  const plugin = veraJsx();
  assert.equal(plugin.name, 'vera-jsx');
  assert.equal(plugin.enforce, 'pre', 'it must run before other transforms, or JSX reaches them raw');

  const run = (id) => plugin.transform.call({}, 'const a = <p>{1}</p>;', id);
  for (const id of ['/app/x.jsx', '/app/x.tsx']) {
    const result = run(id);
    assert.ok(result && /html`<p>\$\{1\}<\/p>`/.test(result.code), `${id} was not transformed`);
  }
  for (const id of ['/app/x.js', '/app/x.ts']) {
    assert.equal(run(id), null, `${id} must be left alone`);
  }
  /** Vite appends a query to almost everything it serves, so stripping it is load-bearing. */
  assert.ok(run('/app/x.jsx?v=abc123')?.code.includes('html`'), 'a Vite query suffix must not stop the transform');
});

test('and honours the documented options', async () => {
  const { veraJsx } = await load('jsx');
  const injected = veraJsx().transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.match(injected, /import \{ html \} from '@verajs\/core'/, 'the default is to inject the import');

  const bare = veraJsx({ inject: false }).transform.call({}, 'const a = <p>{1}</p>;', '/app/x.jsx').code;
  assert.doesNotMatch(bare, /^import/m, '{ inject: false } must not add an import');
  assert.match(bare, /html`<p>\$\{1\}<\/p>`/, 'but must still compile the JSX');
});

/**
 * The transform runs over whole modules, so anything that merely *looks* like JSX must survive. The
 * parser is hand-written, which is exactly why this is asserted rather than assumed.
 */
test('JSX-shaped text that is not JSX is left alone', async () => {
  const { transformJsx } = await load('jsx');
  const untouched = {
    'a double-quoted string': 'const s = "a <p>not jsx</p> b";',
    'a single-quoted string': "const s = 'a <p>not jsx</p> b';",
    'a template literal': 'const s = `a <p>not jsx</p> b`;',
    'a line comment': '// <p>not jsx</p>\nconst a = 1;',
    'a block comment': '/* <p>not jsx</p> */ const a = 1;',
    'a less-than comparison': 'const a = x < y && y > z;',
  };
  for (const [label, source] of Object.entries(untouched)) {
    const out = String(transformJsx(source, '/app/x.jsx', { inject: false }));
    assert.equal(out.trim(), source.trim(), `${label} was rewritten`);
  }
  /** And real JSX beside a string still compiles — the discrimination has to work both ways. */
  const mixed = String(transformJsx('const s = "<b>x</b>"; const a = <p>{1}</p>;', '/app/x.jsx', { inject: false }));
  assert.match(mixed, /const s = "<b>x<\/b>";/, 'the string was rewritten');
  assert.match(mixed, /html`<p>\$\{1\}<\/p>`/, 'the real JSX was not compiled');
});


/**
 * `/hydrate` and `/profiler` are both drop-in replacements for the whole renderer, each bundling its
 * own copy with its own instrumentation hook — so an app can have one of them and not both, and
 * profiling a hydrating app observes an instance nothing renders into.
 *
 * That is a design consequence rather than a bug. The bug was its **silence**: a report of all zeros
 * is exactly what a healthy idle app produces, so the one result that cannot be read was the one
 * being returned. Pass 94.
 */
test('profiling a hydrating app explains itself instead of reporting a silent zero', { skip: isProduction && 'the profiler is not built for production' }, async () => {
  const profiler = await load('renderer/profiler');
  const { renderInto: hydrateInto } = await load('renderer/hydrate');
  const host = dom.window.document.createElement('div');
  host.innerHTML = '<p>1</p>';

  profiler.startProfiling();
  hydrateInto(core.html`<p>${1}</p>`, host);
  hydrateInto(core.html`<p>${2}</p>`, host);
  const report = profiler.stopProfiling();

  assert.equal(host.textContent, '2', 'the app must still render — only the profiler is blind');
  assert.equal(report.frames, 0, 'if this ever observes frames, the two bundles have started sharing a hook');
  const text = profiler.formatReport(report);
  assert.match(text, /No renders observed/);
  assert.match(text, /hydrating app cannot be profiled/, 'the message must name the actual cause');
});

test('and a real profiling session still reports normally', { skip: isProduction && 'the profiler is not built for production' }, async () => {
  const profiler = await load('renderer/profiler');
  const host = dom.window.document.createElement('div');
  profiler.startProfiling();
  profiler.renderInto(core.html`<p>${1}</p>`, host);
  profiler.renderInto(core.html`<p>${2}</p>`, host);
  const text = profiler.formatReport(profiler.stopProfiling());
  assert.match(text, /2 frame\(s\)/, 'the zero-report branch must not swallow a real one');
});

/**
 * **`'slot'` as a point somebody ELSE can register on.**
 *
 * The inserts README documents it precisely — `(slot, root, name)`, return null or undefined to
 * decline, one registrant owns it rather than chaining — and `@verajs/renderer/slots` is the only
 * thing that has ever implemented it. That is the coverage shape this file exists for: an
 * extension API exercised solely by its own author tests the author, not the contract.
 *
 * So this is a foreign implementation, deliberately naive: it takes the host's children whose
 * `slot` attribute names it, drops them where the `<slot>` stood, and returns the documented state
 * object. If the renderer ever stopped resolving the seam, passing those three arguments, or
 * honouring the takeover, this fails while every light-slots suite stays green — because those
 * exercise the shipped module through its own seam rather than the published contract.
 */
test('a third party can implement the slot insert against the documented contract', async () => {
  const seen = [];
  /**
   * There is no unwire, and `'slot'` is single-registrant — so a strategy left armed here would
   * silently own every light render in any test added after this one. The flag is the deregister
   * this registry does not have: declining is already a documented outcome, so switching it off
   * restores exactly the pre-test behaviour rather than approximating it.
   */
  let armed = true;
  /**
   * The renderer's own DESCRIPTOR, not just its function — `connect` is what hands it the
   * registry, and without it `slotSeam()` finds nothing and no insert is ever consulted. The
   * module-scope wiring above registers only `{ on: 'render', fn: renderInto }`, which is enough
   * for rendering and silently not enough for extending, which is worth knowing on its own.
   */
  core.wire([renderer]);
  core.wire({
    name: 'test/foreign-slots',
    on: 'slot',
    priority: 50,
    fn: (slot, root, name) => {
      if (!armed) return null;
      seen.push({ name, root, isSlotElement: slot.localName === 'slot' });
      /** Declining for a shadow root is part of the contract — the platform slots there. */
      if (root.nodeType !== 1) return null;
      const parent = slot.parentNode;
      if (parent === null) return null;
      for (const node of [...root.childNodes])
        if (node.nodeType === 1 && node.getAttribute('slot') === name) parent.insertBefore(node, slot);
      parent.removeChild(slot);
      return { _$park$: () => {} };
    },
  });

  const host = dom.window.document.createElement('div');
  host.innerHTML = '<b slot="a">MINE</b>';
  dom.window.document.body.append(host);
  renderInto(
    { strings: Object.assign(['<div class="box"><slot name="a">FALLBACK</slot></div>'], {
        raw: ['<div class="box"><slot name="a">FALLBACK</slot></div>'] }), values: [] },
    host
  );
  await frame();

  assert.equal(seen.length, 1, 'the renderer resolved the seam and called the foreign insert once');
  assert.equal(seen[0].name, 'a', 'and passed the slot NAME, read after the slot\'s own bindings commit');
  assert.equal(seen[0].root, host, 'and the render root, which is how an insert tells light from shadow');
  assert.ok(seen[0].isSlotElement, 'and the cloned <slot> element itself');
  assert.equal(host.querySelector('.box').textContent, 'MINE', 'the foreign strategy owned the distribution');
  host.remove();
  armed = false;
});

/**
 * The 'value' table row's exclusion, pinned: "strings, numbers, null and undefined never reach
 * it — those take a fast path — so this cannot be used to intercept text." insert-failure-contract
 * works AROUND this fact (its comment says so) and nothing held it, which is the shape that lets
 * a fast-path removal ship silently: every existing 'value' test uses objects, so nothing goes
 * red when primitives suddenly start reaching user code. Booleans fast-path too — measured, and
 * asserted here as the wider truth the doc's narrower claim sits inside.
 */
test("the 'value' chain never sees primitives — the fast path is the security line", () => {
  const seen = [];
  core.wire({ on: 'value', fn: (part, value) => { seen.push(typeof value); return true; }, priority: 40 });
  const host = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(host);
  for (const value of ['text', 42, 0, null, undefined, false, true])
    renderInto(core.html`<p>${value}</p>`, host);
  assert.deepEqual(seen, [], 'a primitive reached the value chain');
  renderInto(core.html`<p>${{ custom: 1 }}</p>`, host);
  assert.equal(seen.length, 1, 'CONTROL: an object still reaches it');
  host.remove();
});
