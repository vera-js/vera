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

        dom.window.customElements.define(
          name,
          class extends dom.window.HTMLElement {
            static styles = css`.${'' + marker} { color: rgb(1, 2, 3); }`;
            connectedCallback() {
              init(this, shadow ? { mode: 'open' } : undefined);
              render(() => html`<i>${marker}</i>`);
            }
          }
        );

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
        if (shadow && occurrences !== 0)
          failures.push(`${name} is a shadow component and hoisted its marker to the document ${occurrences} time(s)`);
        if (!shadow && occurrences !== 1)
          failures.push(`${name} (${count} instances, each re-connected) hoisted its marker ${occurrences} time(s), expected 1`);

        for (const element of made) element.remove();
        await frame();
      }
    }
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(classes, SEEDS.length * ROUNDS, 'the generator did not define the expected number of classes');
  assert.ok(instances > 80, `only ${instances} instances were created`);
  assert.deepEqual(failures.slice(0, 10), [], `${failures.length} class(es) hoisted wrongly:\n  ${failures.slice(0, 10).join('\n  ')}`);
});
