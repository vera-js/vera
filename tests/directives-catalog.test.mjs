/**
 * The interaction catalog (phase 3): every row's core behavior + the CONSTRAINT-SET regressions —
 * outside-click on the container, persist-both-halves, timer teardown on removal, focus-trap
 * stacking, submit prevent/native, bind's type-driven semantics with the aria exception.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const k of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element',
  'DocumentFragment', 'Text', 'Comment', 'Event', 'CustomEvent', 'MouseEvent', 'KeyboardEvent',
  'MutationObserver', 'CSSStyleSheet']) globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.localStorage = dom.window.localStorage;

const { wireDirectives, interaction, settled, rejections, stateOf } = await load('directives');
const { expressions } = await load('directives/expressions');
const doc = dom.window.document;
wireDirectives(interaction);
wireDirectives([expressions]);

const mount = (html) => {
  const host = doc.createElement('div');
  host.innerHTML = html;
  doc.body.appendChild(host);
  return host;
};
const click = (el) => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, composed: true }));

test('text and style reflect; style removes on false/null', async () => {
  const host = mount(`
    <div data-vd-state="{ n: 2, on: true }">
      <p data-vd-text="n * 10"></p>
      <i data-vd-style="{ opacity: on ? 0.5 : null, color: 'red' }"></i>
      <button data-vd-on-click="{ on: !on }">x</button>
    </div>`);
  await settled();
  const p = host.querySelector('p');
  const i = host.querySelector('i');
  assert.equal(p.textContent, '20');
  assert.equal(i.style.getPropertyValue('opacity'), '0.5');
  assert.equal(i.style.getPropertyValue('color'), 'red');
  click(host.querySelector('button'));
  await settled();
  assert.equal(i.style.getPropertyValue('opacity'), '', 'null removed the property');
  host.remove();
});

test('bind: type-driven semantics, the aria exception, form properties live, sinks refused', async () => {
  const host = mount(`
    <div data-vd-state="{ open: false, label: 'hi', v: 'typed' }">
      <button data-vd-bind-aria-expanded="open" data-vd-bind-disabled="!open" data-vd-bind-title="label"></button>
      <input data-vd-bind-value="v">
      <a data-vd-bind-href="'javascript:alert(1)'">x</a>
      <b data-vd-on-click="{ open: true, label: null }">go</b>
    </div>`);
  await settled();
  const button = host.querySelector('button');
  const input = host.querySelector('input');
  const a = host.querySelector('a');
  assert.equal(button.getAttribute('aria-expanded'), 'false', 'aria stringifies false');
  assert.equal(button.hasAttribute('disabled'), true, 'boolean true is present-empty');
  assert.equal(button.getAttribute('title'), 'hi');
  assert.equal(input.value, 'typed', 'the form four write the LIVE property');
  assert.equal(a.hasAttribute('href'), false, 'href is a refused sink');
  assert.ok(rejections(a).some((r) => r.code === 'bind-refused-target'));

  click(host.querySelector('b'));
  await settled();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(button.hasAttribute('disabled'), false, 'boolean false removed');
  assert.equal(button.hasAttribute('title'), false, 'null removed the plain attribute');
  host.remove();
});

test('every: runs, composes, rejects bad intervals, and TEARS DOWN on removal (the leak trap)', async () => {
  const host = mount(`
    <div data-vd-state="{ a: 0, b: 0 }">
      <i data-vd-every="{ 20: { a: a + 1 }, 30: { b: b + 1 }, 0: { a: 999 }, x: { a: 999 } }"></i>
    </div>`);
  await settled();
  const carrier = host.firstElementChild;
  const i = host.querySelector('i');
  assert.ok(rejections(i).filter((r) => r.code === 'every-bad-interval').length >= 2, '0 and x both rejected');
  await new Promise((r) => setTimeout(r, 90));
  const a1 = stateOf(carrier).a;
  const b1 = stateOf(carrier).b;
  assert.ok(a1 >= 2 && b1 >= 1, `both timers ticked (a=${a1}, b=${b1})`);
  assert.ok(stateOf(carrier).a < 900, 'the rejected intervals never ran');
  i.remove();
  await settled();
  const aAfter = stateOf(carrier).a;
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(stateOf(carrier).a, aAfter, 'removal cleared every interval — no leak');
  host.remove();
});

test('sync: state wins at activation, events win after; persist restores AND saves', async () => {
  localStorage.setItem('vd:draft', JSON.stringify('from-storage'));
  const host = mount(`
    <div data-vd-state="{ draft: 'initial', keep: 'x' }" data-vd-persist="draft">
      <input value="user-typed-early" data-vd-sync="draft">
    </div>`);
  await settled();
  const input = host.querySelector('input');
  assert.equal(input.value, 'from-storage', 'persist restored, then sync wrote state into the control');

  input.value = 'now-typed';
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  await settled();
  assert.equal(stateOf(host.firstElementChild).draft, 'now-typed', 'the event wrote state');
  assert.equal(JSON.parse(localStorage.getItem('vd:draft')), 'now-typed', 'persist saved the change — both halves live');
  host.remove();
});

test('focus: trap cycles Tab, stacks, and teardown returns focus to the marked trigger', async () => {
  const host = mount(`
    <div data-vd-state="{ open: true }">
      <button id="trigger" data-vd-focus-return>open</button>
      <nav data-vd-focus-trap data-vd-focus-on="open">
        <a href="#a" id="first">a</a><a href="#b" id="last">b</a>
      </nav>
    </div>`);
  host.querySelector('#trigger').focus();
  await settled();
  const nav = host.querySelector('nav');
  const first = host.querySelector('#first');
  const last = host.querySelector('#last');
  assert.equal(doc.activeElement, first, 'focus-on sent focus to the first focusable');
  last.focus();
  nav.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
  await settled();
  assert.equal(doc.activeElement, first, 'Tab from the last wraps to the first');
  nav.remove();
  await settled();
  assert.equal(doc.activeElement?.id, 'trigger', 'teardown returned focus to the data-vd-focus-return trigger');
  host.remove();
});

test('outside-click lives on the CONTAINER; escape and window targets fire; init runs at activation', async () => {
  const host = mount(`
    <div data-vd-state="{ open: true, loads: 0, scrolls: 0 }">
      <nav data-vd-on-outside-click="{ open: false }" data-vd-show="open"><b id="inside">in</b></nav>
      <i data-vd-init="{ loads: loads + 1 }"></i>
      <u data-vd-on-window-scroll="{ scrolls: scrolls + 1 }"></u>
      <s data-vd-on-escape="{ open: true }"></s>
    </div>`);
  await settled();
  const carrier = host.firstElementChild;
  assert.equal(stateOf(carrier).loads, 1, 'init ran once, at activation');

  click(host.querySelector('#inside'));
  await settled();
  assert.equal(stateOf(carrier).open, true, 'a click INSIDE does not count as outside');
  click(doc.body);
  await settled();
  assert.equal(stateOf(carrier).open, false, 'a click outside closed it — the container trap holds');

  dom.window.dispatchEvent(new dom.window.Event('scroll'));
  await settled();
  assert.equal(stateOf(carrier).scrolls, 1, 'the window target fired');

  doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await settled();
  assert.equal(stateOf(carrier).open, true, 'escape reopened');
  host.remove();
});

test('submit prevents by default; submit-native opts out (the day-one member)', async () => {
  const host = mount(`
    <div data-vd-state="{ sent: 0, native: 0 }">
      <form id="guarded" data-vd-on-submit="{ sent: sent + 1 }"><button>go</button></form>
      <form id="free" data-vd-on-submit-native="{ native: native + 1 }"><button>go</button></form>
    </div>`);
  await settled();
  const carrier = host.firstElementChild;
  let guardedDefault = null;
  let freeDefault = null;
  const submit = (form, capture) => {
    const event = new dom.window.Event('submit', { bubbles: true, cancelable: true });
    form.addEventListener('submit', (e) => capture(e.defaultPrevented), { once: true, capture: false });
    form.dispatchEvent(event);
    return event;
  };
  const e1 = submit(host.querySelector('#guarded'), (v) => (guardedDefault = v));
  const e2 = submit(host.querySelector('#free'), (v) => (freeDefault = v));
  await settled();
  assert.equal(stateOf(carrier).sent, 1, 'the guarded handler ran');
  assert.equal(stateOf(carrier).native, 1, 'the native handler ran');
  assert.equal(e1.defaultPrevented, true, 'on-submit prevented');
  assert.equal(e2.defaultPrevented, false, 'on-submit-native did not');
  void guardedDefault;
  void freeDefault;
  host.remove();
});

test('doc-class and scroll-lock reflect on the document, and locks stack', async () => {
  const host = mount(`
    <div data-vd-state="{ a: true, b: true }">
      <i data-vd-doc-class="{ has-modal: a }"></i>
      <p data-vd-scroll-lock="a"></p>
      <q data-vd-scroll-lock="b"></q>
      <button data-vd-on-click="{ a: false }">x</button>
    </div>`);
  await settled();
  const root = doc.documentElement;
  assert.equal(root.classList.contains('has-modal'), true);
  assert.equal(root.style.overflow, 'hidden');
  click(host.querySelector('button'));
  await settled();
  assert.equal(root.classList.contains('has-modal'), false);
  assert.equal(root.style.overflow, 'hidden', 'the second lock still holds');
  host.querySelector('q').remove();
  await settled();
  assert.equal(root.style.overflow, '', 'the last lock released on teardown');
  host.remove();
});

test('init runs at activation; on-load is the ELEMENT\'s load event, not the lifecycle', async () => {
  /**
   * These were one word until 2026-09-07, and the collision was live: `on-window-load` meant the
   * real event while `on-load` meant activation, so `<img data-vd-on-load>` — which every author
   * writes expecting the image — fired before the image had done anything.
   */
  const host = mount(`
    <div data-vd-state="{ started: 0, loaded: 0 }">
      <i data-vd-init="{ started: started + 1 }"></i>
      <img data-vd-on-load="{ loaded: loaded + 1 }" />
    </div>`);
  await settled();
  const carrier = host.querySelector('[data-vd-state]');
  assert.equal(stateOf(carrier).started, 1, 'init ran once at activation');
  assert.equal(stateOf(carrier).loaded, 0, 'and on-load has NOT fired — nothing has loaded');

  /** `load` does not bubble, so this only works because the member is a per-element listener. */
  host.querySelector('img').dispatchEvent(new dom.window.Event('load'));
  await settled();
  assert.equal(stateOf(carrier).loaded, 1, 'the element\'s own load event ran the program');
  assert.equal(stateOf(carrier).started, 1, 'and init did not run again');
  host.remove();
  await settled();
});
