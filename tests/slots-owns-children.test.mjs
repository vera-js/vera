/**
 * **`ownsChildren`**: a light component that renders no `<slot>` and reads its own authored children declares it, on its
 * class (`static ownsChildren = true`) or through `define({ ownsChildren: true })`, and on a page that wires slots its
 * children stay where they were written. The control: an ordinary light host on the same page still has its children
 * distributed. In its own process: wire is global. `VERA_OWNS_UNWIRED=1` reruns the declarations on a page without
 * slots, where nothing may be said.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { load, isProduction } from './dist.mjs';

const unwired = process.env.VERA_OWNS_UNWIRED === '1';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'MutationObserver', 'ShadowRoot', 'CSSStyleSheet', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);

const { init, define, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
const said = [];
console.warn = (...a) => said.push(a.join(' '));
console.error = (...a) => said.push(a.join(' '));
wire(unwired ? [renderer] : [renderer, (await load('renderer/slots')).slots]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

/** Reads its own <b> children and renders beside them, no <slot>: the case the declaration names. */
customElements.define('oc-static', class extends HTMLElement {
  static ownsChildren = true;
  connectedCallback() { init(this, () => () => html`<main>${this.querySelectorAll(':scope > b').length}</main>`); }
});
/** The functional path: define builds the class and sets the static before registering it. */
define({ tag: 'oc-defined', ownsChildren: true }, (host) => () => html`<main>${host.querySelectorAll(':scope > b').length}</main>`);
/** The same component without the declaration: the red it prevents. */
customElements.define('oc-plain', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<main></main>`); }
});
/** An ordinary slots host on the same page: the control that slots still distributes. */
customElements.define('oc-slotted', class extends HTMLElement {
  connectedCallback() { init(this, () => () => html`<main><slot></slot></main>`); }
});
/** Declares it and renders a <slot> anyway: development says so. */
customElements.define('oc-contradicts', class extends HTMLElement {
  static ownsChildren = true;
  connectedCallback() { init(this, () => () => html`<main><slot></slot></main>`); }
});

const mount = async (tag) => {
  const el = document.createElement(tag);
  el.innerHTML = '<b>one</b><b>two</b>';
  document.body.append(el);
  flush();
  await settle();
  return el;
};
const inPlace = (el) => [...el.querySelectorAll('b')].every((b) => b.parentNode === el && b.closest('[data-vm-unassigned]') === null);

for (const tag of ['oc-static', 'oc-defined'])
  test(`${tag}: its authored children stay where they were written, and nothing is said${unwired ? ' (slots not wired)' : ''}`, async () => {
    said.length = 0;
    const el = await mount(tag);
    assert.equal(inPlace(el), true);
    assert.equal(el.querySelector('main').textContent, '2', 'the component read both of its own children');
    assert.deepEqual(said, []);
    el.remove();
  });

test('define sets the static on the class it builds', () => {
  assert.equal(customElements.get('oc-defined').ownsChildren === true, true);
});

if (!unwired) {
  test('without the declaration the same component loses them to the unassigned carrier (the red this prevents)', async () => {
    const el = await mount('oc-plain');
    assert.equal(inPlace(el), false);
    assert.equal(el.querySelectorAll('[data-vm-unassigned] b').length, 2);
    el.remove();
  });

  test('control: an ordinary light host on the same page still has its children distributed into its slot', async () => {
    const el = await mount('oc-slotted');
    assert.equal(el.querySelectorAll('main b').length, 2, 'both children distributed into the slot position');
    el.remove();
  });

  test('a component declaring ownsChildren that renders a <slot> is told, once', { skip: isProduction }, async () => {
    said.length = 0;
    const a = await mount('oc-contradicts');
    const b = await mount('oc-contradicts');
    const lines = said.filter((line) => line.includes('owns-children-slot'));
    assert.equal(lines.length, 1, said.join('\n'));
    assert.equal(lines[0].startsWith('[vera]'), true);
    a.remove();
    b.remove();
  });

  test('on a page without slots, the declarations say nothing and change nothing', () => {
    const file = fileURLToPath(import.meta.url);
    const { NODE_TEST_CONTEXT: _runner, ...env } = process.env;
    const conditions = process.env.VERA_DIST ? [] : ['--conditions', 'development'];
    const run = spawnSync(process.execPath, [...conditions, '--test-reporter=tap', file], { env: { ...env, VERA_OWNS_UNWIRED: '1' }, encoding: 'utf8', timeout: 120_000 });
    const passed = Number(/^# pass (\d+)$/m.exec(run.stdout)?.[1] ?? 0);
    assert.ok(passed >= 3, `positive control: the child ran its rows (passed ${passed})\n${run.stdout}\n${run.stderr}`);
    assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  });
}
