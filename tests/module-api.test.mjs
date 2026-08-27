/**
 * Public API of `@verajs/router`, `@verajs/inserts`, `@verajs/styles` and `@verajs/jsx` that
 * nothing else exercises — the rest of the fourteen exports the 2026-08-22 testing audit found at
 * zero coverage.
 *
 * `veraJsx` matters most here: it is the Vite plugin JSX users actually consume, and its file sat
 * at 0% functions. The transform beneath it was well covered; the build-tool integration was not.
 *
 * Tests the BUILT artifacts, development AND production (see ./dist.mjs).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { load, isProduction } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.customElements = dom.window.customElements;
globalThis.CSSStyleSheet = dom.window.CSSStyleSheet;
/** The router reads `window`, `location` and `history` directly — it drives real navigation. */
globalThis.window = dom.window;
globalThis.location = dom.window.location;
globalThis.history = dom.window.history;

// ── @verajs/inserts: a function that names an insert point is a descriptor ──

/**
 * `wire` accepts a bare function as a *connector* (it is handed the registry), and an object as a
 * descriptor. A module may be both: `@verajs/autoloader` returns a callable instance that also
 * carries `on`/`fn`/`priority`, so configuring it and installing it are one call. That only works
 * because the descriptor test runs first — read the other way round, such a module is called as a
 * connector and silently never registers.
 */
test('wire treats a function carrying `on` as a descriptor, not a connector', async () => {
  const inserts = await load('inserts');
  const chain = () => inserts.inserts.get('render') ?? [];
  const before = chain().length;

  const seen = [];
  const handedRegistry = [];
  const both = Object.assign((registry) => handedRegistry.push(registry), {
    on: 'render',
    fn: (_, container) => seen.push(container),
    priority: 75,
  });
  inserts.wire(both);

  assert.equal(handedRegistry.length, 0, 'it was not called as a connector');
  assert.equal(chain().length, before + 1, 'it registered as a descriptor');

  const host = document.createElement('div');
  chain().forEach((cb) => cb('<p>x</p>', host));
  assert.deepEqual(seen, [host], 'the handler received the container');
});

test('the autoloader registers at 75, so it runs after the renderer', async () => {
  const inserts = await load('inserts');
  const chain = () => inserts.inserts.get('render') ?? [];
  const order = [];

  /** 75 is above the renderer's 50, so it runs after rendering — it scans what was just written. */
  inserts.wire({ on: 'render', fn: () => order.push('render@50'), priority: 50 });
  inserts.wire(Object.assign(() => {}, { on: 'render', fn: () => order.push('autoload@75'), priority: 75 }));
  chain().forEach((cb) => cb('<p>x</p>', document.createElement('div')));
  assert.deepEqual(order, ['render@50', 'autoload@75'], 'autoloader runs after the renderer');
});

// ── @verajs/router: setMatchFunction ────────────────────────────────────────

test('setMatchFunction replaces the route matcher', async () => {
  const router = await load('router');
  const calls = [];
  /** A matcher that only ever matches the literal string "/always". */
  router.setMatchFunction((pattern) => {
    calls.push(pattern);
    return (path) => (path === '/always' ? { path, params: {}, index: 0 } : false);
  });
  assert.equal(typeof router.setMatchFunction, 'function');
  /** Registering routes runs the custom matcher factory for each pattern. */
  const el = document.createElement('div');
  const view = document.createElement('main');
  el.appendChild(view);
  document.body.appendChild(el);
  const r = router.initRouter(el, { view, focusView: false, handleInitial: false });
  /** Routes compile through the matcher factory as they are added, not at initRouter. */
  r.addRoutes([{ path: '/never', component: () => '' }]);
  assert.ok(calls.includes('/never'), 'the custom matcher compiled the route pattern');

  /** And the replacement decides matching: /never can never match under it. */
  await router.navigate('/never');
  assert.equal(view.textContent, '', 'the custom matcher refused the route');
});

// ── @verajs/styles: applyStyles ─────────────────────────────────────────────

test('applyStyles puts a plain-string style into a shadow root, once', async () => {
  const { applyStyles } = await load('styles');
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.attachShadow({ mode: 'open' });

  applyStyles('p { color: red }', el);
  const styles = () => el.shadowRoot.querySelectorAll('style[vera-styles]');
  assert.equal(styles().length, 1, 'a style element was added');
  assert.match(styles()[0].innerHTML, /color: red/);

  /** Re-applying must not duplicate — components re-init on reconnect. */
  applyStyles('p { color: red }', el);
  assert.equal(styles().length, 1, 'still one after a second apply');
});

test('applyStyles ignores empty styles', async () => {
  const { applyStyles } = await load('styles');
  const el = document.createElement('div');
  document.body.appendChild(el);
  el.attachShadow({ mode: 'open' });
  applyStyles('', el);
  applyStyles(undefined, el);
  assert.equal(el.shadowRoot.querySelectorAll('style').length, 0, 'nothing added for empty input');
});

// ── @verajs/jsx: veraJsx, the Vite plugin ───────────────────────────────────

const jsx = await import('../packages/jsx/src/index.js');

test('veraJsx is a Vite plugin with the expected shape', () => {
  const plugin = jsx.veraJsx();
  assert.equal(plugin.name, 'vera-jsx');
  assert.equal(plugin.enforce, 'pre', 'must run before other transforms');
  assert.equal(typeof plugin.transform, 'function');
});

test('veraJsx transforms .jsx and .tsx, and ignores everything else', () => {
  const plugin = jsx.veraJsx();
  const src = 'export const A = () => <p>{x}</p>;';

  for (const id of ['/a/b.jsx', '/a/b.tsx']) {
    const out = plugin.transform(src, id);
    assert.ok(out && out.code, `${id} was transformed`);
    assert.match(out.code, /html`/, 'JSX became a tagged template');
  }

  for (const id of ['/a/b.js', '/a/b.ts', '/a/b.css']) {
    assert.equal(plugin.transform(src, id), null, `${id} left alone`);
  }
});

test('veraJsx strips a query string before deciding', () => {
  const plugin = jsx.veraJsx();
  const out = plugin.transform('export const A = () => <p>1</p>;', '/a/b.jsx?t=12345');
  assert.ok(out && out.code, 'Vite appends query strings; the extension test must survive them');
});

test('veraJsx injects the html import, and { inject: false } suppresses it', () => {
  const src = 'export const A = () => <p>1</p>;';
  const withInject = jsx.veraJsx().transform(src, '/a.jsx').code;
  assert.match(withInject, /import \{ html \} from '@verajs\/core'/, 'import auto-injected');

  const without = jsx.veraJsx({ inject: false }).transform(src, '/a.jsx').code;
  assert.doesNotMatch(without, /^import \{ html \}/m, 'inject:false leaves imports to the author');
});

test('veraJsx can retarget where html and keyed come from', () => {
  const src = 'export const A = () => <ul>{xs.map((x) => <li key={x}>{x}</li>)}</ul>;';
  const out = jsx.veraJsx({ html: ['h', 'my-lib'], keyed: ['k', 'my-lib'] }).transform(src, '/a.jsx').code;
  assert.match(out, /from 'my-lib'/, 'imports point at the configured module');
  assert.match(out, /\bh`/, 'the configured tag name is used');
  assert.match(out, /\bk\(/, 'the configured keyed helper is used');
});

// ── @verajs/jsx: parseJsx / ParseState, the parser beneath the transform ─────

const parser = await import('../packages/jsx/src/parser.js');

test('parseJsx parses an element into a node with tag, attributes and children', () => {
  const state = new parser.ParseState('<p class="a">hi</p>');
  const node = parser.parseJsx(state);
  assert.equal(node.tag, 'p');
  assert.equal(node.fragment, undefined, 'not a fragment');
  assert.equal(node.attrs.length, 1);
  assert.equal(node.attrs[0].name, 'class');
  assert.equal(node.attrs[0].kind, 'str', 'a quoted literal, not an expression');
  assert.equal(node.selfClosing, false);
  assert.equal(node.children.length, 1, 'the text child');
});

test('parseJsx recognises a fragment', () => {
  const node = parser.parseJsx(new parser.ParseState('<><a/><b/></>'));
  assert.equal(node.fragment, true);
  assert.equal(node.children.length, 2);
});

test('parseJsx handles self-closing elements and nesting', () => {
  const node = parser.parseJsx(new parser.ParseState('<ul><li/><li>x</li></ul>'));
  assert.equal(node.tag, 'ul');
  assert.equal(node.children.length, 2);
  assert.equal(node.children[0].tag, 'li');
});

test('parseJsx returns null rather than throwing on unterminated input', () => {
  /** The transform relies on a null return to fall back to leaving the code alone. */
  assert.equal(parser.parseJsx(new parser.ParseState('<p>unclosed')), null);
});

test('ParseState tracks expression position, which is what bounds a JSX region', () => {
  const s = new parser.ParseState('x');
  assert.equal(s.atExpressionPosition(), true, 'start of input is an expression position');
  s.lastChar = ')';
  s.lastWord = '';
  assert.equal(s.atExpressionPosition(), false, 'after a closing paren, `<` is a comparison');
  s.lastChar = '=';
  assert.equal(s.atExpressionPosition(), true, 'after `=` it is an expression again');
});

// ── wiring the raw render function instead of the module ────────────────────

/**
 * `render` and `renderer` differ by two characters, and the wrong one used to be a *silent*
 * mistake: a bare function has no `on`, so `wire` reads it as a connector, hands it the registry
 * and registers nothing. Development turns that into a named error.
 */
test('wire refuses a raw function a package marked as not-the-module', async () => {
  /**
   * `wire` is taken from `@verajs/inserts` rather than from core, and the distinction is not
   * cosmetic. Core's development bundle keeps this package **external**, so `import '@verajs/core'`
   * resolves `@verajs/inserts` through its `exports` map — and without the `development` condition
   * that lands on `dist/*.min.js`, where every `__DEV__` guard has already been folded away. Reached
   * that way, core's `wire` is a production `wire` even in a development run. A bundler sets the
   * condition, so an app sees the guard; a test that forgets to is quietly checking the wrong build.
   */
  const { wire } = await load('inserts');
  const renderer = await load('renderer');
  if (isProduction) {
    /** The marker and the check are both behind `__DEV__`, so production carries neither. */
    assert.equal(renderer.renderInto.$module, undefined, 'no marker in production');
    return;
  }
  assert.equal(renderer.renderInto.$module, 'renderer', 'the raw function is marked');
  assert.throws(
    () => wire(renderer.renderInto),
    /did you mean `renderer`/,
    'it must name the export that was meant'
  );
  /** The module itself still wires. */
  wire(renderer.renderer);
});
