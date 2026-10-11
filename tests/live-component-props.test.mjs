/**
 * **`!name` on a COMPONENT is delivered, not merely written.**
 *
 * A component receives a bound property through `adoptProperty` — the door core's `_$adopt$` opens, which puts a
 * store-backed accessor on the element and re-renders on every write. `.name` always went through it; `!name` wrote a
 * plain property, so a RUNNING component never heard a `!name`-only change: the element held the new value and its
 * render went on showing the old one. Released through 0.2.x (measured on main 81cbab6), and on hydration — where every
 * prop arrives after the child is already running — it read as "the server's value never converges"
 * (`tests/browser/hydrate-component-props.test.js`). An earlier probe changed `.dot` and `!live` together and missed
 * it: `.dot`'s re-render repainted `!live` too. Every row below changes `!name` ALONE.
 *
 * And the rest of `!`'s contract holds: an unchanged `!name` costs one read and renders nothing; a getter with no setter
 * is refused (said once), never thrown at; on adoption a plain control's user state is recorded while any other
 * `!name` is written.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';
import { hydrating } from './hydration.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MutationObserver', 'CSSStyleSheet', 'cancelAnimationFrame'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

const { init, html } = await load('core');
const renderInto = await hydrating();
const { spread } = await load('renderer/spread');
const doc = dom.window.document;
const frame = () => new Promise((resolve) => dom.window.requestAnimationFrame(() => setTimeout(resolve, 0)));

/** A component reading `live` and `item`, counting its renders. */
let renders = 0;
customElements.define('lp-row', class extends HTMLElement {
  connectedCallback() {
    init(this, () => {
      return () => {
        renders++;
        return html`<p>${String(this.live)} · ${String(this.item)}</p>`;
      };
    });
  }
});
const text = (host) => host.querySelector('p').textContent;
const mount = () => {
  const host = doc.createElement('div');
  doc.body.append(host);
  return host;
};

test('a running component hears a `!name`-only change', async () => {
  const host = mount();
  const draw = (live) => renderInto(html`<lp-row !live=${live} .item=${'fixed'}></lp-row>`, host);
  draw('a');
  await frame();
  assert.equal(text(host), 'a · fixed', 'CONTROL: the first value arrived');
  draw('b');
  await frame();
  assert.equal(text(host), 'b · fixed', 'the component re-rendered with the new `!live` — before, it kept showing `a`');
  host.remove();
});

test('through spread too: a `!name` bag key reaches a running component', async () => {
  const host = mount();
  const draw = (live) => renderInto(html`<lp-row ${spread({ '!live': live, '.item': 'fixed' })}></lp-row>`, host);
  draw('a');
  await frame();
  assert.equal(text(host), 'a · fixed', 'CONTROL: the first value arrived');
  draw('b');
  await frame();
  assert.equal(text(host), 'b · fixed');
  host.remove();
});

test('an unchanged `!name` across ten parent renders renders the child zero extra times', async () => {
  const host = mount();
  const draw = () => renderInto(html`<lp-row !live=${'same'} .item=${'fixed'}></lp-row>`, host);
  draw();
  await frame();
  const before = renders;
  assert.ok(before > 0, 'CONTROL: the child rendered at all');
  for (let n = 0; n < 10; n++) draw();
  await frame();
  assert.equal(renders, before, 'the comparison holds: an equal value is never written, so nothing re-renders');
  host.remove();
});

test('`!name` and `.name` changed in one render coalesce to one child render', async () => {
  const host = mount();
  const draw = (live, item) => renderInto(html`<lp-row !live=${live} .item=${item}></lp-row>`, host);
  draw('a', 'x');
  await frame();
  draw('b', 'x'); // `!live` is delivered once — its accessor is installed by this first late write
  await frame();
  const before = renders;
  draw('c', 'y');
  await frame();
  assert.equal(text(host), 'c · y');
  assert.equal(renders - before, 1, 'both writes land in the store; the scheduler runs the render once');
  host.remove();
});

/**
 * The rows that GUARD the comparison itself (vera-5a's mutation: always deliver → only these red). An unchanged
 * primitive delivered again dies at core's same-value store write, so the zero-renders row above cannot see it. One per
 * spelling: the template and spread each carry their own inline copy of the read.
 */
for (const [spelling, bind] of [
  ['template', (value) => html`<lp-row !live=${value} .item=${'fixed'}></lp-row>`],
  ['spread', (value) => html`<lp-row ${spread({ '!live': value, '.item': 'fixed' })}></lp-row>`],
]) test(`${spelling}: an unchanged OBJECT \`!name\` is not delivered again on every render — compared by identity, raw`, async () => {
  const host = mount();
  const value = { label: 'x' };
  const draw = () => renderInto(bind(value), host);
  draw();
  await frame();
  draw(); // received now: its accessor is the component's
  await frame();
  const row = host.querySelector('lp-row');
  const accessor = Object.getOwnPropertyDescriptor(row, 'live');
  assert.ok(accessor?.set, 'CONTROL: the component received `live` — a store-backed accessor of its own');
  assert.notEqual(row.live, value, 'CONTROL: the accessor hands the object back as a store proxy, never `===` it');
  let deliveries = 0;
  Object.defineProperty(row, 'live', { ...accessor, set(next) { deliveries++; accessor.set.call(this, next); } });
  for (let n = 0; n < 10; n++) draw();
  assert.equal(deliveries, 0, 'compared against the raw value the store holds — reading the proxy re-delivered it ten times');
  host.remove();
});

/** A custom element that never calls `init`, with a getter and no setter: the value cannot be delivered. */
customElements.define('lp-fixed', class extends HTMLElement {
  get live() {
    return 'own';
  }
});

test('a getter with no setter is refused, never thrown at — and said once', () => {
  const host = mount();
  const said = [];
  const warn = console.warn;
  console.warn = (...args) => said.push(args.join(' '));
  try {
    const draw = (live) => renderInto(html`<lp-fixed !live=${live}></lp-fixed>`, host);
    for (const value of ['a', 'b', 'c']) assert.doesNotThrow(() => draw(value));
  } finally {
    console.warn = warn;
  }
  assert.equal(host.querySelector('lp-fixed').live, 'own', 'the class answers, untouched');
  if (!isProduction) {
    const ours = said.filter((line) => line.includes('getter with no setter'));
    assert.equal(ours.length, 1, `once for the element and name, however many renders: ${ours.join(' | ')}`);
    assert.match(ours[0], /`!live`/, 'and it names the `!` spelling the author wrote');
  }
  host.remove();
});

/** Server markup for a template: a client render's HTML, its anchor comments stripped. */
const served = (result) => {
  const scratch = doc.createElement('div');
  renderInto(result, scratch);
  return scratch.innerHTML.replace(/<!---->/g, '');
};

test('on adoption, a plain control\'s `!name` that is not user state is WRITTEN — `!indeterminate` has no markup', () => {
  const draw = (on) => html`<input type="checkbox" !indeterminate=${on}>`;
  const host = mount();
  host.innerHTML = served(draw(true));
  const input = host.querySelector('input');
  assert.equal(input.indeterminate, false, 'CONTROL: the server cannot say it — the page shows it unset');
  renderInto(draw(true), host);
  assert.equal(host.querySelector('input'), input, 'CONTROL: adopted, not re-rendered');
  assert.equal(input.indeterminate, true, 'written on adoption — before, every `!name` was recorded and this never arrived');
  host.remove();
});

test('on adoption, user state stands: `!open` a person toggled before the script arrived is recorded', () => {
  const draw = (open) => html`<details !open=${open}><summary>s</summary>body</details>`;
  const host = mount();
  host.innerHTML = served(draw(false));
  const details = host.querySelector('details');
  details.open = true; // the person opened it before the bundle landed
  renderInto(draw(false), host);
  assert.equal(host.querySelector('details'), details, 'CONTROL: adopted');
  assert.equal(details.open, true, 'what the person did stands');
  renderInto(draw(true), host);
  renderInto(draw(false), host);
  assert.equal(details.open, false, 'and the binding is live afterwards');
  host.remove();
});
