/**
 * `@event` bindings, over their whole lifecycle — which nothing had a lens on.
 *
 * An event listener is the most **deferred** call a template makes. Every other binding is checked
 * the moment it commits; a listener is checked when a *user clicks*, which in development may be
 * never. That is the same shape as the setters audited in pass 79, and it had the same defect: a
 * value that cannot listen was accepted in silence and failed later, naming an internal.
 *
 * The differential here is the platform itself. `addEventListener` accepts **two** shapes — a
 * function, and an object with a `handleEvent` method — and the second is not exotic: it is how you
 * write a listener that carries state without a closure, and lit-html supports it. The renderer
 * called `.call()` unconditionally, so passing the platform's own listener shape bound successfully
 * and then threw `this._handler.call is not a function` on **every** dispatch.
 *
 * Both renderer entries are exercised, because `@verajs/renderer/hydrate` inlines its own copy of
 * this file and a fix to one is not a fix to the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

/**
 * **jsdom does not rethrow an exception raised inside a listener** — it reports it to the virtual
 * console as a `jsdomError`, exactly as a browser reports one to `window.onerror`. So
 * `assert.doesNotThrow(() => element.click())` is an assertion that cannot fail, and asserting that
 * way is how a dispatch-time `TypeError` on every click would have gone on reading green. The errors
 * are captured here instead, which is the only form of this check that is real.
 */
const dispatchErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (error) => dispatchErrors.push(error.detail?.message ?? error.message));

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, virtualConsole });
for (const key of ['document', 'Node', 'HTMLElement', 'DocumentFragment', 'Text', 'Comment', 'Event', 'Element'])
  globalThis[key] = dom.window[key];

const html = (strings, ...values) => ({ strings, values });
const div = () => dom.window.document.createElement('div');
const click = (el) => el.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

/** Both published entries; each inlines its own renderer, so each needs its own assertion. */
const ENTRIES = Object.fromEntries(
  await Promise.all(['renderer', 'renderer/hydrate'].map(async (name) => [name, (await load(name)).renderInto]))
);

/** Collects `console.warn` for the duration of `work`. */
const listen = (work) => {
  const said = [];
  const real = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try { work(); } finally { console.warn = real; }
  return said;
};

test('the platform accepts an object listener, so this is the behaviour to match', () => {
  let fired = 0;
  const button = dom.window.document.createElement('button');
  button.addEventListener('click', { handleEvent() { fired++; } });
  click(button);
  assert.equal(fired, 1, 'addEventListener({ handleEvent }) is valid DOM in every engine');
});

for (const [name, renderInto] of Object.entries(ENTRIES)) {
  test(`${name}: an object with handleEvent listens, as it does on the platform`, () => {
    let fired = 0;
    const container = div();
    renderInto(html`<button @click=${{ handleEvent() { fired++; } }}>x</button>`, container);
    dispatchErrors.length = 0;
    click(container.querySelector('button'));
    assert.deepEqual(dispatchErrors, [], 'the platform listener shape raised at dispatch');
    assert.equal(fired, 1, 'bound without error and then never fired — the pass 88 defect');
  });

  test(`${name}: swapping the handler leaves exactly one listener`, () => {
    let first = 0, second = 0;
    const container = div();
    const draw = (handler) => renderInto(html`<button @click=${handler}>x</button>`, container);
    draw(() => first++);
    draw(() => second++);
    click(container.querySelector('button'));
    assert.equal(first, 0, 'the replaced handler still fired');
    assert.equal(second, 1, 'the new handler fired once, not twice');
  });

  test(`${name}: a handler removed and restored is not registered twice`, () => {
    let fired = 0;
    const container = div();
    const handler = () => fired++;
    const draw = (value) => renderInto(html`<button @click=${value}>x</button>`, container);
    draw(handler);
    draw(null);
    draw(handler);
    click(container.querySelector('button'));
    assert.equal(fired, 1);
  });

  test(`${name}: a nulled handler stops firing`, () => {
    let fired = 0;
    const container = div();
    const draw = (value) => renderInto(html`<button @click=${value}>x</button>`, container);
    draw(() => fired++);
    draw(null);
    click(container.querySelector('button'));
    assert.equal(fired, 0);
  });

  test(`${name}: the handler receives the element as \`this\``, () => {
    const container = div();
    let receivedElement = false;
    /** Compared in place rather than captured — aliasing `this` is what `no-this-alias` refuses. */
    renderInto(
      html`<button @click=${function () { receivedElement = this === container.querySelector('button'); }}>x</button>`,
      container
    );
    click(container.querySelector('button'));
    assert.ok(receivedElement, '`this` was not the bound element');
  });

  test(`${name}: a value that cannot listen is inert rather than throwing on every dispatch`, () => {
    for (const value of ['alert(1)', 42, true, {}]) {
      const container = div();
      listen(() => renderInto(html`<button @click=${value}>x</button>`, container));
      dispatchErrors.length = 0;
      click(container.querySelector('button'));
      assert.deepEqual(dispatchErrors, [], `@click=${JSON.stringify(value)} raised at dispatch`);
    }
  });
}

test('a value that cannot listen is named where it is written', { skip: isProduction && 'development-only diagnostics' }, () => {
  for (const [value, expected] of [['alert(1)', 'a string'], [42, 'a number'], [true, 'a boolean'], [{}, 'an object with no handleEvent method']]) {
    const said = listen(() => ENTRIES.renderer(html`<button @click=${value}>x</button>`, div()));
    const warning = said.find((line) => line.includes('cannot listen'));
    assert.ok(warning, `nothing was said about @click=${JSON.stringify(value)}`);
    assert.ok(warning.startsWith('[vera]'), 'every framework diagnostic carries the prefix');
    assert.ok(warning.includes('@click'), 'the warning names the binding');
    assert.ok(warning.includes('<button>'), 'and the element it is on');
    assert.ok(warning.includes(expected), `the warning should say ${expected}, said: ${warning}`);
  }
});

test('a conditionally-bound handler is silent, because that is the ordinary idiom', () => {
  /**
   * `@click=${enabled && onClick}` produces `false` when disabled. It already behaves correctly —
   * nothing callable, so nothing fires — and warning about it would fire on working code. `true` is
   * produced by no idiom at all, which is why it is warned about and `false` is not.
   */
  for (const value of [false, null, undefined]) {
    const said = listen(() => ENTRIES.renderer(html`<button @click=${value}>x</button>`, div()));
    assert.deepEqual(said.filter((line) => line.includes('cannot listen')), [],
      `@click=${String(value)} should be silent`);
  }
});

test('production says nothing about any of it', { skip: !isProduction && 'production-only', }, () => {
  const said = listen(() => {
    for (const value of ['alert(1)', 42, true, {}]) ENTRIES.renderer(html`<button @click=${value}>x</button>`, div());
  });
  assert.deepEqual(said, []);
});

test('a handler survives a keyed move and fires once', async () => {
  const { keyed } = await load('renderer/keyed');
  const fired = [];
  const container = div();
  const draw = (rows) =>
    ENTRIES.renderer(
      html`<ul>${rows.map((row) => keyed(row, html`<li data-id=${row} @click=${() => fired.push(row)}>${row}</li>`))}</ul>`,
      container
    );
  draw(['a', 'b', 'c']);
  draw(['c', 'b', 'a']);
  click(container.querySelector('li[data-id="a"]'));
  assert.deepEqual(fired, ['a']);
});
