/**
 * **<vera-menu> in real engines**: the platform's popover opening it (with no script at all, too), focus by how it
 * opened, the keys a user presses, typeahead, which items close it, Tab leaving it, its CSS placement under the
 * trigger, and context mode at the pointer. jsdom has no popover, anchor positioning or real focus, so these are the
 * engines' rows.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/menu';
import { until } from './until.js';
import { ON } from './engine.js';

wire([renderer, styles]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const ITEMS =
  '<button value="rename">Rename</button><button value="copy" disabled>Copy</button><button value="edit">Edit</button><hr>' +
  '<button role="menuitemcheckbox" aria-checked="false" value="wrap">Word wrap</button>' +
  '<button value="keep" data-keep-open>Zoom in</button><button value="delete" aria-disabled="true">Delete</button>';
const MARKUP = `<button slot="trigger">Actions</button><div slot="menu">${ITEMS}</div>`;
const ANCHORS = CSS.supports('position-anchor', '--a');

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const mount = async (inner = MARKUP, attributes = '', tag = 'vera-menu') => {
  const holder = document.createElement('div');
  holder.style.padding = '40px';
  holder.innerHTML = `<button class="before">before</button><${tag} ${attributes}>${inner}</${tag}><button class="after">after</button>`;
  document.body.append(holder);
  made.push(holder);
  await frame();
  return holder.querySelector(tag);
};
const menuOf = (el) => el.querySelector(':scope > [slot="menu"]');
const triggerOf = (el) => el.querySelector(':scope > [slot="trigger"]');
const isOpen = (el) => menuOf(el).matches(':popover-open');
const focused = () => document.activeElement?.getAttribute('value') ?? document.activeElement?.getAttribute('slot') ?? document.activeElement?.className;
const center = (node) => {
  const rect = node.getBoundingClientRect();
  return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
};

it('with no script: served popover and popovertarget open, light-dismiss and Escape-close the menu (CONTROL: closed at first)', async () => {
  const el = await mount(`<button slot="trigger" popovertarget="ns-menu">Actions</button><div slot="menu" id="ns-menu" popover="auto">${ITEMS}</div>`, '', 'x-menu-unscripted');
  expect(customElements.get('x-menu-unscripted'), 'no element is defined').to.equal(undefined);
  expect(isOpen(el), 'CONTROL: closed').to.equal(false);
  await sendMouse({ type: 'click', position: center(triggerOf(el)) });
  await until(() => isOpen(el), `${ON}: the trigger opened it`, 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !isOpen(el), `${ON}: Escape closed it`, 2000);
});

it('keyboard: Enter on the trigger opens with the first item focused, the arrows skip a disabled item, Escape returns to the trigger', async () => {
  const el = await mount();
  triggerOf(el).focus();
  await sendKeys({ press: 'Enter' });
  await until(() => isOpen(el) && focused() === 'rename', `${ON}: open, first item focused (focus: ${focused()})`, 2000);
  await sendKeys({ press: 'ArrowDown' });
  expect(focused(), `${ON}: natively disabled Copy is skipped`).to.equal('edit');
  await sendKeys({ press: 'End' });
  expect(focused(), `${ON}: End reaches the aria-disabled item`).to.equal('delete');
  await sendKeys({ press: 'ArrowDown' });
  expect(focused(), `${ON}: ArrowDown wraps`).to.equal('rename');
  await sendKeys({ press: 'Escape' });
  await until(() => !isOpen(el), 'Escape closed it', 2000);
  expect(focused(), `${ON}: focus is back on the trigger`).to.equal('trigger');
});

it('keyboard: ArrowUp on the trigger opens with the last item focused; ArrowDown with the first', async () => {
  const el = await mount();
  triggerOf(el).focus();
  await sendKeys({ press: 'ArrowUp' });
  await until(() => isOpen(el) && focused() === 'delete', `${ON}: last item (focus: ${focused()})`, 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !isOpen(el), 'closed', 2000);
  await sendKeys({ press: 'ArrowDown' });
  await until(() => isOpen(el) && focused() === 'rename', `${ON}: first item (focus: ${focused()})`, 2000);
});

it('pointer: a click opens with the menu itself focused, and the first ArrowDown reaches the first item, ArrowUp the last', async () => {
  const el = await mount();
  await sendMouse({ type: 'click', position: center(triggerOf(el)) });
  await until(() => isOpen(el), `${ON}: open`, 2000);
  expect(document.activeElement === menuOf(el), `${ON}: the menu is focused, no item (focus: ${focused()})`).to.equal(true);
  await sendKeys({ press: 'ArrowDown' });
  expect(focused(), `${ON}: the first ArrowDown`).to.equal('rename');
  await sendKeys({ press: 'Escape' });
  await until(() => !isOpen(el), 'closed', 2000);
  await sendMouse({ type: 'click', position: center(triggerOf(el)) });
  await until(() => isOpen(el), 'open again', 2000);
  await sendKeys({ press: 'ArrowUp' });
  expect(focused(), `${ON}: the first ArrowUp`).to.equal('delete');
});

it('typing jumps to the next item starting with the letters, passing a disabled one', async () => {
  const el = await mount();
  triggerOf(el).focus();
  await sendKeys({ press: 'Enter' });
  await until(() => focused() === 'rename', 'open', 2000);
  await sendKeys({ press: 'z' });
  expect(focused(), `${ON}: z`).to.equal('keep');
  await sendKeys({ press: 'c' });
  expect(focused(), `${ON}: c finds no enabled Copy, so focus stays`).to.equal('keep');
});

it('Enter on an item fires menuaction and closes; Space on a checkbox item toggles it and stays; data-keep-open stays; aria-disabled does nothing', async () => {
  const el = await mount();
  const heard = [];
  el.addEventListener('menuaction', (event) => heard.push([event.detail.value, event.detail.checked, event.detail.reason]));
  triggerOf(el).focus();
  await sendKeys({ press: 'Enter' });
  await until(() => focused() === 'rename', 'open', 2000);
  await sendKeys({ press: 'End' });
  await sendKeys({ press: 'Enter' });
  expect(isOpen(el), `${ON}: aria-disabled: still open`).to.equal(true);
  expect(heard, 'aria-disabled: no menuaction').to.deep.equal([]);
  menuOf(el).querySelector('[value="wrap"]').focus();
  await sendKeys({ press: ' ' });
  expect(isOpen(el), `${ON}: Space on a checkbox item stays open`).to.equal(true);
  expect(menuOf(el).querySelector('[value="wrap"]').getAttribute('aria-checked')).to.equal('true');
  menuOf(el).querySelector('[value="keep"]').focus();
  await sendKeys({ press: 'Enter' });
  expect(isOpen(el), `${ON}: data-keep-open stays open`).to.equal(true);
  menuOf(el).querySelector('[value="edit"]').focus();
  await sendKeys({ press: 'Enter' });
  await until(() => !isOpen(el), `${ON}: Enter on an item closed it`, 2000);
  expect(focused(), `${ON}: focus back on the trigger`).to.equal('trigger');
  expect(heard).to.deep.equal([['wrap', true, 'keyboard'], ['keep', null, 'keyboard'], ['edit', null, 'keyboard']]);
});

it('a pointer click on an item closes, reason "pointer"; a canceled menuaction keeps it open', async () => {
  const el = await mount();
  const heard = [];
  el.addEventListener('menuaction', (event) => {
    heard.push(event.detail.reason);
    if (event.detail.value === 'rename') event.preventDefault();
  });
  await sendMouse({ type: 'click', position: center(triggerOf(el)) });
  await until(() => isOpen(el), 'open', 2000);
  await sendMouse({ type: 'click', position: center(menuOf(el).querySelector('[value="rename"]')) });
  expect(isOpen(el), `${ON}: canceled: still open`).to.equal(true);
  await sendMouse({ type: 'click', position: center(menuOf(el).querySelector('[value="edit"]')) });
  await until(() => !isOpen(el), `${ON}: closed`, 2000);
  expect(heard).to.deep.equal(['pointer', 'pointer']);
});

it('Tab closes the menu and moves on past the trigger', async () => {
  const el = await mount();
  triggerOf(el).focus();
  await sendKeys({ press: 'Enter' });
  await until(() => focused() === 'rename', 'open', 2000);
  await sendKeys({ press: 'Tab' });
  await until(() => !isOpen(el), `${ON}: Tab closed it`, 2000);
  expect(focused(), `${ON}: focus moved on from the trigger`).to.equal('after');
});

it('placement: where anchor positioning exists, the menu opens under the trigger at its inline start', async () => {
  const el = await mount();
  await sendMouse({ type: 'click', position: center(triggerOf(el)) });
  await until(() => isOpen(el), 'open', 2000);
  const [t, m] = [triggerOf(el).getBoundingClientRect(), menuOf(el).getBoundingClientRect()];
  if (!ANCHORS) return expect(m.width > 0, `${ON}: no anchor positioning: shown where the platform puts it`).to.equal(true);
  expect(Math.abs(m.left - t.left) < 2, `${ON}: inline start ${m.left} vs ${t.left}`).to.equal(true);
  expect(m.top >= t.bottom && m.top - t.bottom < 12, `${ON}: under the trigger ${m.top} vs ${t.bottom}`).to.equal(true);
});

it('context mode: a right click on the target opens the menu at the pointer with the menu focused (CONTROL: no native menu, default prevented)', async () => {
  const el = await mount(`<div slot="target" style="block-size:120px;inline-size:240px;background:#eee">Area</div><div slot="menu" aria-label="Area actions">${ITEMS}</div>`, 'opener="context"');
  const target = el.querySelector('[slot="target"]');
  let prevented = null;
  document.addEventListener('contextmenu', (event) => (prevented = event.defaultPrevented), { once: true });
  const rect = target.getBoundingClientRect();
  const [x, y] = [Math.round(rect.left + 60), Math.round(rect.top + 30)];
  await sendMouse({ type: 'click', button: 'right', position: [x, y] });
  await until(() => isOpen(el), `${ON}: open`, 2000);
  expect(prevented, 'CONTROL: the native menu was prevented').to.equal(true);
  expect(document.activeElement === menuOf(el), `${ON}: the menu is focused`).to.equal(true);
  if (ANCHORS) {
    const m = menuOf(el).getBoundingClientRect();
    expect(Math.abs(m.left - x) < 2 && m.top >= y && m.top - y < 12, `${ON}: at the pointer ${m.left},${m.top} vs ${x},${y}`).to.equal(true);
  }
});

it('context mode from the keyboard: Shift+F10 and the ContextMenu key open the menu once, at the target, first item focused', async () => {
  for (const press of ['Shift+F10', 'ContextMenu']) {
    const el = await mount(`<div slot="target" tabindex="0" style="block-size:80px;inline-size:200px;background:#eee">Area</div><div slot="menu" aria-label="Area actions">${ITEMS}</div>`, 'opener="context"');
    const target = el.querySelector('[slot="target"]');
    let opens = 0;
    menuOf(el).addEventListener('toggle', (event) => (opens += event.newState === 'open' ? 1 : 0));
    target.focus();
    await sendKeys({ press });
    await until(() => isOpen(el) && focused() === 'rename', `${ON}: ${press} opened it with the first item focused (focus: ${focused()})`, 2000);
    /** Past the key's release task and the platform's own contextmenu: two frames. */
    await frame();
    await frame();
    expect(opens, `${ON}: ${press} opened it once, never twice (the platform's contextmenu and ours)`).to.equal(1);
    if (ANCHORS) {
      const [t, m] = [target.getBoundingClientRect(), menuOf(el).getBoundingClientRect()];
      expect(Math.abs(m.left - t.left) < 2 && m.top >= t.bottom && m.top - t.bottom < 12, `${ON}: ${press} placed it at the target's block end ${m.left},${m.top} vs ${t.left},${t.bottom}`).to.equal(true);
    }
    await sendKeys({ press: 'Escape' });
    await until(() => !isOpen(el), 'closed', 2000);
  }
});
