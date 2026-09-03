/**
 * THE MONEY TEST — one <vera-select>, both modes. In light mode, with @verajs/renderer/slots
 * wired, a user's slotted trigger is captured, distributed, and wired with the SAME handlers and
 * ARIA as the built-in one — with ZERO changes to the component beyond its assignedElements()
 * reads becoming slotted() (which answers in either mode). This is the whole point of the light-
 * slots project: one component version, four corners.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { load } from './dist.mjs';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
for (const key of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','requestAnimationFrame','cancelAnimationFrame','Event','CustomEvent','KeyboardEvent','MouseEvent','FormData','MutationObserver','Comment','Text'])
  globalThis[key] = dom.window[key];

const { wire } = await load('core');
const { renderer } = await load('renderer');
const { styles } = await load('styles');
const { slots, slotted } = await load('renderer/slots');
wire([renderer, styles, slots]); // the app opts into light-DOM slots

await load('ui');
const frame = () => new Promise((r) => dom.window.requestAnimationFrame(r));
const OPTS = [{ label: 'Alpha', value: 'a' }, { label: 'Beta', value: 'b' }];

test('light + user-slotted trigger: captured, distributed, wired — zero component change', async () => {
  const el = dom.window.document.createElement('vera-select');
  el.setAttribute('light', '');
  el.setAttribute('aria-label', 'Flavor');
  const trigger = dom.window.document.createElement('button');
  trigger.setAttribute('slot', 'trigger');
  trigger.className = 'my-page-trigger';
  const value = dom.window.document.createElement('span');
  value.setAttribute('slot', 'value');
  value.textContent = 'Pick…';
  trigger.append(value);
  el.append(trigger);
  dom.window.document.body.append(el);
  el.options = OPTS;
  await frame();

  // no shadow root (light mode), no literal <slot> in the light DOM
  assert.equal(el.shadowRoot, null, 'light mode');
  assert.equal(el.querySelector('slot'), null, 'slots were distributed, no <slot> element left');

  // the user's own button was distributed into the trigger position AND wired by the component
  const wired = el.querySelector('.my-page-trigger');
  assert.ok(wired, 'the page trigger is in the rendered tree');
  assert.equal(wired, trigger, 'and it is the SAME node the user supplied (identity kept)');
  assert.equal(wired.getAttribute('role'), 'combobox', 'wired with combobox ARIA, like the built-in trigger');
  assert.equal(wired.getAttribute('aria-haspopup'), 'listbox');

  // it drives the same behavior: clicking opens the menu
  wired.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await frame();
  assert.equal(el.querySelector('[part="menu"]').getAttribute('data-state'), 'open', 'the slotted trigger opens the menu');

  // pick commits and the slotted value node is stamped (nested [slot=value] inside the trigger)
  el.querySelector('[part="option"]').click();
  await frame();
  assert.equal(el.value, 'a', 'a pick through the slotted trigger commits');
  assert.equal(value.getAttribute('data-label'), 'Alpha', 'the nested slotted value node is stamped, its children untouched');
  assert.equal(value.textContent, 'Pick…', 'you slot it, you own it');
  el.remove();
});

test('the SAME markup in SHADOW mode also works (native slots) — one component, both corners', async () => {
  const el = dom.window.document.createElement('vera-select'); // no light attr = shadow
  el.setAttribute('aria-label', 'Flavor');
  const trigger = dom.window.document.createElement('button');
  trigger.setAttribute('slot', 'trigger');
  trigger.className = 'shadow-trigger';
  el.append(trigger);
  dom.window.document.body.append(el);
  el.options = OPTS;
  await frame();
  assert.ok(el.shadowRoot, 'shadow mode');
  assert.equal(trigger.getAttribute('role'), 'combobox', 'the slotted trigger wired via native assignment + slotted()');
  trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await frame();
  assert.equal(el.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state'), 'open');
  el.remove();
});

/**
 * **Replacing a slotted trigger, live, in LIGHT mode.** This is the case the component could not
 * handle here until `<slot>` bindings started working in light DOM: `vera-select` keeps itself in
 * step through `@slotchange` on each of its slots, which fired only in shadow mode, so a light-mode
 * app that swapped its trigger was left with an unwired one — no role, no ARIA, no keyboard.
 *
 * The component was not changed for this. It already bound `@slotchange`; the event simply reaches
 * it now.
 */
test('light: swapping the slotted trigger re-wires it, and removing it restores the built-in one', async () => {
  const el = dom.window.document.createElement('vera-select');
  el.setAttribute('light', '');
  el.setAttribute('aria-label', 'Flavor');
  const first = dom.window.document.createElement('button');
  first.setAttribute('slot', 'trigger');
  first.textContent = 'FIRST';
  el.append(first);
  dom.window.document.body.append(el);
  el.options = OPTS;
  await frame();
  await frame();

  const wiring = (node) => ({
    role: node?.getAttribute('role'),
    haspopup: node?.getAttribute('aria-haspopup'),
  });
  assert.deepEqual(wiring(el.querySelector('button')), { role: 'combobox', haspopup: 'listbox' },
    'CONTROL: the first slotted trigger is wired');

  /** Swap it for a different element entirely. */
  const second = dom.window.document.createElement('button');
  second.setAttribute('slot', 'trigger');
  second.textContent = 'SECOND';
  first.remove();
  el.append(second);
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await frame();

  assert.equal(el.querySelector('button'), second, 'the new trigger is the one on screen');
  assert.deepEqual(wiring(second), { role: 'combobox', haspopup: 'listbox' },
    'and it was wired — this is what did not happen before slot bindings worked in light mode');

  /** It is not merely decorated: it drives the component. */
  second.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await frame();
  await frame();
  assert.ok(el.querySelector('[role="listbox"]'), 'the replaced trigger opens the listbox');
  assert.equal(second.getAttribute('aria-expanded'), 'true');

  /** Remove it, and the component's OWN trigger comes back — a <div role="combobox">, not a button. */
  second.remove();
  await frame();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await frame();
  const built = el.querySelector('[role="combobox"]');
  assert.ok(built, 'the fallback trigger returned');
  assert.equal(built.localName, 'div', "the component's own trigger, not the user's");
  assert.equal(el.querySelector('button'), null, 'and nothing of the user\'s is left behind');
  assert.equal(built.getAttribute('aria-haspopup'), 'listbox', 'wired like any other');
  el.remove();
});

/**
 * **Two light-mode selects on one page must not share ids.** A shadow root is its own id scope; a
 * LIGHT host's ids land in the page document beside every other component's. Both instances wrote
 * `id="listbox"` and `id="opt-0"`, so the second one's `aria-controls` and `aria-activedescendant`
 * resolved to the FIRST one's listbox and options — every light-mode select after the first pointed
 * a screen reader at another widget, and nothing failed.
 *
 * Two instances is the smallest case that can show it, which is why one instance passed everything.
 */
test('light: two selects on a page keep their ARIA pointing at their own parts', async () => {
  const made = [];
  for (let index = 0; index < 2; index++) {
    const el = dom.window.document.createElement('vera-select');
    el.setAttribute('light', '');
    el.setAttribute('aria-label', `S${index}`);
    dom.window.document.body.append(el);
    el.options = OPTS;
    made.push(el);
  }
  await frame();
  await frame();

  /** Open both, so each renders its listbox and options into the page. */
  for (const el of made) {
    el.querySelector('[role="combobox"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    await frame();
    await frame();
  }
  assert.equal(made[1].querySelectorAll('[role="option"]').length, OPTS.length,
    'CONTROL: the second select really did render its own options');

  /** No id may appear twice anywhere in the document. */
  const ids = [...dom.window.document.querySelectorAll('[id]')].map((node) => node.id);
  const duplicated = ids.filter((id, at) => ids.indexOf(id) !== at);
  assert.deepEqual([...new Set(duplicated)], [], 'two instances wrote the same id');

  /** And every ARIA id reference resolves INSIDE the component that wrote it. */
  for (const el of made)
    for (const attribute of ['aria-controls', 'aria-activedescendant'])
      for (const node of el.querySelectorAll(`[${attribute}]`)) {
        const id = node.getAttribute(attribute);
        const target = dom.window.document.getElementById(id);
        assert.ok(target, `${attribute}="${id}" points at nothing`);
        assert.ok(el.contains(target),
          `${attribute}="${id}" resolves to another component's element — the reader is sent elsewhere`);
      }
  for (const el of made) el.remove();
});

/**
 * **HTML-authored options AND a slotted trigger, together.** Both are supported, and in light mode
 * they collided: seeding options from `<option>` children cleared the host wholesale, which took
 * the slotted trigger with it. The same markup worked in shadow mode, so the component looked
 * correct anywhere anyone was likely to test it.
 *
 * Only the nodes the parse actually claimed are removed now. The comparison is the point — identical
 * markup, both modes, same result.
 */
test('light: authored options do not eat a slotted trigger', async () => {
  const readings = {};
  for (const mode of ['light', 'shadow']) {
    const el = dom.window.document.createElement('vera-select');
    if (mode === 'light') el.setAttribute('light', '');
    el.setAttribute('aria-label', 'Flavor');
    el.innerHTML =
      '<option value="a">Alpha</option><option value="b" selected>Beta</option>' +
      '<button slot="trigger" class="mine">MY TRIGGER</button>';
    dom.window.document.body.append(el);
    await frame();
    await frame();

    const trigger = el.querySelector('button.mine');
    readings[mode] = {
      options: el.options.length,
      seeded: el.value?.value ?? el.value,
      triggerKept: trigger !== null,
      triggerWired: trigger?.getAttribute('role') ?? null,
      slotted: slotted(el, 'trigger').length,
      /** The authored <option>s must NOT be left showing as stray text. */
      strayOptions: el.querySelectorAll('option').length,
    };
    el.remove();
  }

  assert.equal(readings.shadow.triggerKept, true, 'CONTROL: shadow mode keeps the slotted trigger');
  assert.equal(readings.light.triggerKept, true, 'and light mode must not eat it');
  assert.equal(readings.light.triggerWired, 'combobox', 'the slotted trigger is wired, not merely present');
  assert.equal(readings.light.slotted, 1, 'and it is in the capture map');
  assert.equal(readings.light.options, 2, 'while the authored options still seeded the list');
  assert.equal(readings.light.strayOptions, 0, 'and were consumed, not left as stray visible text');
});
