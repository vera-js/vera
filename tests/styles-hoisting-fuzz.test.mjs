/**
 * Style hoisting under generated component classes.
 *
 * `styles.ts` states the rule outright: light-DOM `static styles` are *"hoisted to the document once
 * per component class, ever"*. Two invariants follow that are arithmetic rather than comparisons
 * against the framework, and both are answerable here:
 *
 * 1. **One hoist per class**, however many instances are created, connected, disconnected and
 *    reconnected. Each generated class carries a unique marker in its CSS, so a miscount names the
 *    class rather than only the number.
 * 2. **A shadow component hoists nothing to the document** — its styles belong to its root.
 *
 * ## What this file deliberately does not test
 *
 * **The scoping.** jsdom has no `@scope` — the package warns about exactly this at runtime — so the
 * entire scoped branch falls through to the unscoped fallback here. Rewriting
 * `@scope (${element.localName})` to `@scope (div)`, which is the mistake that would let one
 * component's rules reach another's, **survives this suite completely**.
 *
 * That case lives in `tests/browser/styles.test.js` ("one component's light-DOM styles do not reach
 * another component"), where the same mutation fails four assertions. `CLAUDE.md`'s rule applies
 * directly: jsdom is the regression net, never the oracle, for anything the platform decides — and
 * whether a `@scope` block binds to the tag that wrote it is entirely the platform's decision.
 *
 * Kept here rather than moved wholesale because 30 classes and 111 instances of churn is not
 * something a browser suite wants to run, and the counting half needs the volume.
 */
import { load } from './dist.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><head></head><body><div id="host"></div></body>', { pretendToBeVisual: true });
for (const key of [
  'window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event',
  'CustomEvent', 'MouseEvent',
])
  globalThis[key] = dom.window[key];

const { isProduction } = await import('./dist.mjs');
const core = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
core.wire([renderer, styles]);
const { init, render, html, css } = core;

const D = dom.window.document;
const host = D.getElementById('host');
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** Everything this page has hoisted, as text. */
const hoisted = () => [...D.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n');

const SEEDS = [7, 19, 41, 83, 167, 2718];
const ROUNDS = 5;
let nextTag = 0;

test('a class hoists its light-DOM styles exactly once, and a shadow class hoists none', async () => {
  const failures = [];
  let classes = 0;
  let instances = 0;
  let derived = 0;
  /** Light-DOM base classes from earlier rounds, and the shadow mode each one's callback installs. */
  const parents = [];
  const shadowOf = new WeakMap();

  /** The package warns once per page about the missing `@scope`; it is expected and not the subject. */
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    for (const seed of SEEDS) {
      const random = rng(seed);

      for (let round = 0; round < ROUNDS; round++) {
        classes++;
        const name = `x-sty-${nextTag++}`;
        const marker = `m${seed}r${round}`;
        const shadow = random() < 0.4;

        /**
         * **Some classes derive from an earlier one, which is the shape that produced Defect 58.**
         *
         * Hoisting is deduplicated with a flag on the class, and `class Child extends Base` makes
         * `Base` the prototype of `Child` — so a flag read without `hasOwnProperty` finds the base's
         * and the subclass never hoists at all. Every class this generator built was flat, so its
         * "once per class" invariant could not see a class that hoisted *zero* times.
         *
         * The base is always from an earlier round, so it has already been instantiated: that is the
         * base-before-child order, and the only one that failed. Inheritance looks upward only, so
         * the reverse order hoists both even when the read is wrong.
         */
        const base = parents.length && random() < 0.4 ? parents[Math.floor(random() * parents.length)] : null;
        const Component = base
          ? class extends base {
              static styles = css`.${'' + marker} { color: rgb(1, 2, 3); }`;
            }
          : class extends dom.window.HTMLElement {
              static styles = css`.${'' + marker} { color: rgb(1, 2, 3); }`;
              connectedCallback() {
                init(this, shadow ? { mode: 'open' } : undefined);
                render(() => html`<i>${marker}</i>`);
              }
            };

        dom.window.customElements.define(name, Component);
        if (!base) parents.push(Component);
        if (base) derived++;
        /** A subclass inherits its base's `connectedCallback`, so it inherits the base's shadow mode. */
        const isShadow = base ? shadowOf.get(base) : shadow;
        shadowOf.set(Component, isShadow);

        /** Several instances, each churned, so "once per class" is put under real pressure. */
        const count = 2 + Math.floor(random() * 4);
        const made = [];
        for (let i = 0; i < count; i++) {
          const element = D.createElement(name);
          host.appendChild(element);
          made.push(element);
          instances++;
          await frame();
        }
        for (const element of made) {
          element.remove();
          await frame();
          host.appendChild(element);
          await frame();
        }

        const occurrences = hoisted().split(marker).length - 1;
        if (isShadow && occurrences !== 0)
          failures.push(`${name} is a shadow component and hoisted its marker to the document ${occurrences} time(s)`);
        if (!isShadow && occurrences !== 1)
          failures.push(`${name} (${count} instances, each re-connected) hoisted its marker ${occurrences} time(s), expected 1`);

        for (const element of made) element.remove();
        await frame();
      }
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(classes, SEEDS.length * ROUNDS, 'the generator did not define the expected number of classes');
  /** A generator that produced no subclasses would satisfy every check below without testing them. */
  assert.ok(derived > 4, `only ${derived} of ${classes} classes derived from another — the hierarchy arm is not running`);
  assert.ok(instances > 80, `only ${instances} instances were created`);
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} class(es) hoisted wrongly:\n  ${failures.slice(0, 10).join('\n  ')}`);
});

/**
 * **`::slotted()` is the shadow-only selector with nothing to become.** `:host` is translated for a
 * light host, so it needs no warning; distributed nodes here are ordinary descendants, and giving
 * `::slotted()` an equivalent would mean MARKING them — DOM noise in the user's own tree, which the
 * light-slots design refused. It is also the fair one to lose: slotted content is the user's own
 * DOM, and in light mode their page CSS already reaches it.
 *
 * Development-only: the check and the message fold out of production.
 */
test('a light host is told about ::slotted(), and NOT about :host', { skip: isProduction }, async () => {
  const said = [];
  const original = console.warn;
  console.warn = (message) => said.push(String(message));
  try {
    const name = `x-sty-${nextTag++}`;
    customElements.define(
      name,
      class extends dom.window.HTMLElement {
        static styles = core.css`:host { color: red } ::slotted(b) { color: blue } p { color: green }`;
        connectedCallback() {
          core.init(this); // LIGHT
          core.render(() => core.html`<p>own</p>`);
        }
      }
    );
    D.body.append(D.createElement(name));
    await frame();
  } finally {
    console.warn = original;
  }
  const warning = said.find((message) => message.includes('no shadow root'));
  assert.ok(warning, `expected a diagnostic, got ${JSON.stringify(said)}`);
  assert.match(warning, /^\[vera\] /, 'findable with one filter, like every diagnostic here');
  assert.match(warning, /`::slotted\(\)`/, 'it names the construct that cannot work');
  assert.match(warning, /translated to `:scope` for you/,
    'and says :host needs nothing — warning about a selector that now works would be a lie');
});

test('the light-DOM rewrite translates selectors and leaves values alone', async () => {
  const original = console.warn;
  console.warn = () => {};
  let text;
  try {
    const name = `x-sty-${nextTag++}`;
    customElements.define(
      name,
      class extends dom.window.HTMLElement {
        static styles = core.css`
          :host { a: 1 }
          :host(.flag) { b: 2 }
          :host(:not(.x)) { c: 3 }
          :is(:host, .y) { d: 4 }
          @media (min-width: 1px) { :host { e: 5 } }
          :host-context(.z) { f: 6 }
          .md\\:host { g: 7 }
          q { content: ":host" }
          i { background: url(/x/:host.png) }
        `;
        connectedCallback() {
          core.init(this); // LIGHT
          core.render(() => core.html`<p>own</p>`);
        }
      }
    );
    D.body.append(D.createElement(name));
    await frame();
    text = hoisted();
  } finally {
    console.warn = original;
  }

  /** Selectors: translated. */
  assert.match(text, /:scope \{ a: 1 \}/, 'a bare :host');
  assert.match(text, /:scope\.flag \{ b: 2 \}/, ':host(.flag) — and NOT :scope(.flag), which is not a selector');
  assert.match(text, /:scope:not\(\.x\) \{ c: 3 \}/, 'nested parens survive');
  assert.match(text, /:is\(:scope, \.y\) \{ d: 4 \}/, 'inside :is()');
  assert.match(text, /:scope \{ e: 5 \}/, 'inside @media');

  /** Not selectors, or not translatable: left exactly as written. */
  assert.match(text, /:host-context\(\.z\) \{ f: 6 \}/, 'Firefox and WebKit never shipped :host-context()');
  assert.match(text, /\.md\\:host \{ g: 7 \}/, 'an ESCAPED identifier is a class name, not a selector — Tailwind emits these');
  assert.match(text, /content: ":host"/, 'a string value');
  assert.match(text, /url\(\/x\/:host\.png\)/, 'an unquoted url');
  assert.doesNotMatch(text, /:scope\.png|:scope"/, 'nothing inside a value was touched');
});
