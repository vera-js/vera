/**
 * **<vera-dialog> in real engines**: opening by the trigger and by the platform's invokers (with no script at all, too),
 * the host's `open` both ways, every user close going through a cancelable `cancel`, a form's `returnValue`, light
 * dismiss by the press-and-release rule (and never for an alertdialog), focus back to the trigger when the opener is gone,
 * and the page not scrolling while open. jsdom has no `showModal`, so these are the engines' rows.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/dialog';
/** The element entry is its own bundle carrying its own copy of the setup, so it stands in for a second copy of the package. */
import { defineAs } from '@vera-components/dialog/element';
import { until } from './until.js';
import { ON } from './engine.js';

wire([renderer, styles]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const INVOKERS = 'commandForElement' in HTMLButtonElement.prototype;
const FORM =
  '<button slot="trigger">Edit</button><dialog><h2>Edit profile</h2><form method="dialog"><input name="n" autofocus>' +
  '<button value="cancel" formnovalidate>Cancel</button><button value="save">Save</button></form></dialog>';

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const mount = async (inner = FORM, attributes = '', tag = 'vera-dialog') => {
  const holder = document.createElement('div');
  holder.innerHTML = `<button class="before">before</button><${tag} ${attributes}>${inner}</${tag}>`;
  document.body.append(holder);
  made.push(holder);
  await frame();
  return holder.querySelector(tag);
};
const dialogOf = (el) => el.querySelector(':scope > dialog');
const modal = (el) => dialogOf(el).matches(':modal');
const center = (node) => {
  const rect = node.getBoundingClientRect();
  return [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)];
};

it('with no script: a commandfor invoker opens the served dialog as a modal where the engine has invokers', async () => {
  const el = await mount('<button slot="trigger" commandfor="ns-d" command="show-modal">Open</button><dialog id="ns-d"><h2>Hi</h2></dialog>', '', 'x-dialog-unscripted');
  expect(customElements.get('x-dialog-unscripted'), 'no element is defined').to.equal(undefined);
  el.querySelector('button').click();
  await frame();
  expect(modal(el), `${ON}: ${INVOKERS ? 'the invoker opened it' : 'no invokers here: it stays closed'}`).to.equal(INVOKERS);
  if (INVOKERS) {
    await sendKeys({ press: 'Escape' });
    await until(() => !modal(el), 'Escape closed it', 2000);
  }
});

it('the trigger opens it as a modal with the autofocus field focused, and the host gains open', async () => {
  const el = await mount();
  el.querySelector('[slot="trigger"]').click();
  await until(() => modal(el), `${ON}: open as a modal`, 2000);
  await until(() => el.hasAttribute('open'), `${ON}: the host reflects open`, 2000);
  expect(document.activeElement === dialogOf(el).querySelector('input'), `${ON}: autofocus decided the first focus`).to.equal(true);
});

it('the host\'s open both ways: writing it opens and closes; Escape removes it and the dialog fires close', async () => {
  const el = await mount();
  const heard = [];
  dialogOf(el).addEventListener('cancel', () => heard.push('cancel'));
  dialogOf(el).addEventListener('close', () => heard.push('close'));
  el.setAttribute('open', '');
  await until(() => modal(el), `${ON}: open attribute opened it`, 2000);
  el.removeAttribute('open');
  await until(() => !dialogOf(el).open, `${ON}: removing it closed it`, 2000);
  el.setAttribute('open', '');
  await until(() => modal(el), 'open again', 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !dialogOf(el).open, `${ON}: Escape closed it`, 2000);
  await until(() => !el.hasAttribute('open'), `${ON}: and removed the host's open`, 2000);
  expect(heard.slice(-2), `${ON}: a cancel, then close`).to.deep.equal(['cancel', 'close']);
});

it('a form closes it with its returnValue, and the host\'s open goes', async () => {
  const el = await mount();
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  dialogOf(el).querySelector('button[value="save"]').click();
  await until(() => !dialogOf(el).open, `${ON}: the form closed it`, 2000);
  expect(dialogOf(el).returnValue).to.equal('save');
  await until(() => !el.hasAttribute('open'), `${ON}: the host's open went`, 2000);
});

it('dismiss="outside": a press and release outside close it through a cancelable cancel; a drag from inside does not', async () => {
  const el = await mount('<dialog><h2>Filters</h2><p style="block-size:120px">x</p></dialog>', 'dismiss="outside"');
  const heard = [];
  dialogOf(el).addEventListener('cancel', (event) => {
    heard.push('cancel');
    if (heard.length === 1) event.preventDefault();
  });
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  const box = dialogOf(el).getBoundingClientRect();
  const out = [Math.round(box.left / 2), Math.round(box.top / 2) + 2];
  const [ix, iy] = center(dialogOf(el));
  await sendMouse({ type: 'move', position: [ix, iy] });
  await sendMouse({ type: 'down' });
  await sendMouse({ type: 'move', position: out });
  await sendMouse({ type: 'up' });
  await frame();
  expect(modal(el), `${ON}: a drag from inside out does not close it`).to.equal(true);
  expect(heard, 'and asks nothing').to.deep.equal([]);
  await sendMouse({ type: 'click', position: out });
  await until(() => heard.length === 1, `${ON}: an outside press asked through cancel`, 2000);
  expect(modal(el), `${ON}: canceled, it stays open`).to.equal(true);
  await sendMouse({ type: 'click', position: out });
  await until(() => !dialogOf(el).open, `${ON}: the second outside press closed it`, 2000);
});

it('an alertdialog never closes on a press outside, even with dismiss="outside" (CONTROL: Escape still closes it)', async () => {
  const el = await mount('<dialog role="alertdialog"><h2>Delete?</h2><p data-vera-part="description">Gone.</p><button autofocus>Cancel</button></dialog>', 'dismiss="outside"');
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  const box = dialogOf(el).getBoundingClientRect();
  await sendMouse({ type: 'click', position: [Math.round(box.left / 2), Math.round(box.top / 2) + 2] });
  await frame();
  await frame();
  expect(modal(el), `${ON}: still open`).to.equal(true);
  await sendKeys({ press: 'Escape' });
  await until(() => !dialogOf(el).open, `${ON}: CONTROL: Escape closed it`, 2000);
});

it('focus goes back to the trigger when what opened it is gone (CONTROL: the platform returns it when it is not)', async () => {
  const el = await mount();
  const opener = document.createElement('button');
  opener.textContent = 'opener';
  el.parentElement.append(opener);
  opener.focus();
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !dialogOf(el).open, 'closed', 2000);
  expect(document.activeElement === opener, `${ON}: CONTROL: the platform returned focus to the opener`).to.equal(true);
  el.setAttribute('open', '');
  await until(() => modal(el), 'open again', 2000);
  opener.remove();
  await sendKeys({ press: 'Escape' });
  await until(() => !dialogOf(el).open, 'closed again', 2000);
  await until(() => document.activeElement === el.querySelector('[slot="trigger"]'), `${ON}: the trigger took focus (focus: ${document.activeElement?.localName})`, 2000);
});

/**
 * The page's scrollbar while locked: a page that scrolled keeps its scrollbar's room (`scrollbar-gutter: stable` on the
 * root), a page that did not gets no gutter, which would move its content. The runner draws overlay scrollbars, which
 * never shift anything, so the row reads the mechanism, which every engine answers: the root's mark and its computed
 * gutter. That a gutter keeps classic-scrollbar content still was measured headed on Chromium (the browser ledger).
 */
for (const tall of [false, true])
  it(`a ${tall ? 'scrolling' : 'short'} page ${tall ? 'keeps' : 'gets no'} scrollbar gutter while a dialog is open`, async () => {
    const page = document.createElement('div');
    page.style.blockSize = tall ? '3000px' : '0';
    document.body.append(page);
    made.push(page);
    const el = await mount();
    const root = document.documentElement;
    expect(getComputedStyle(root).scrollbarGutter, 'CONTROL: no gutter before it opens').to.equal('auto');
    el.setAttribute('open', '');
    await until(() => modal(el), 'open', 2000);
    expect(root.hasAttribute('data-vera-scrolled'), `${ON}: the root's mark`).to.equal(tall);
    expect(getComputedStyle(root).scrollbarGutter, `${ON}: the root's gutter while open`).to.equal(tall ? 'stable' : 'auto');
    el.removeAttribute('open');
    await until(() => !dialogOf(el).open, 'closed', 2000);
    expect(getComputedStyle(root).scrollbarGutter, `${ON}: no gutter after it closes`).to.equal('auto');
  });

it('the page does not scroll while a dialog is open (CONTROL: it does again after)', async () => {
  const el = await mount();
  const html = document.documentElement;
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  expect(getComputedStyle(html).overflow, `${ON}: locked`).to.equal('hidden');
  el.removeAttribute('open');
  await until(() => !dialogOf(el).open, 'closed', 2000);
  await frame();
  expect(getComputedStyle(html).overflow, `${ON}: CONTROL: released`).to.not.equal('hidden');
});

it('a dialog inside another element\'s shadow root locks the page too (CONTROL: released after)', async () => {
  const outer = document.createElement('div');
  document.body.append(outer);
  made.push(outer);
  const root = outer.attachShadow({ mode: 'open' });
  root.innerHTML = `<vera-dialog>${FORM}</vera-dialog>`;
  await frame();
  const el = root.querySelector('vera-dialog');
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  expect(getComputedStyle(document.documentElement).overflow, `${ON}: the page is locked from a shadow root`).to.equal('hidden');
  el.removeAttribute('open');
  await until(() => !dialogOf(el).open, 'closed', 2000);
  await frame();
  expect(getComputedStyle(document.documentElement).overflow, `${ON}: CONTROL: released`).to.not.equal('hidden');
});

it('moving an open dialog keeps it open as a modal, with the host\'s open, and the page stays locked; removing it for good unlocks the page', async () => {
  const el = await mount();
  const heard = [];
  dialogOf(el).addEventListener('close', () => heard.push('close'));
  el.setAttribute('open', '');
  await until(() => modal(el), 'open', 2000);
  const holder = el.parentElement;
  el.remove();
  holder.append(el);
  await frame();
  await frame();
  expect(dialogOf(el).open && modal(el), `${ON}: open as a modal where it landed`).to.equal(true);
  expect(el.hasAttribute('open'), `${ON}: the host keeps open`).to.equal(true);
  expect(getComputedStyle(document.documentElement).overflow, `${ON}: still locked`).to.equal('hidden');
  expect(heard.length <= 1, `${ON}: at most one close reached the app (${heard.length})`).to.equal(true);
  el.remove();
  await frame();
  expect(getComputedStyle(document.documentElement).overflow, `${ON}: removed for good, the page scrolls again`).to.not.equal('hidden');
});

it('a dialog open at load is a modal and locks the page', async () => {
  const el = await mount(FORM, 'open');
  await until(() => modal(el), `${ON}: open as a modal at load`, 2000);
  expect(getComputedStyle(document.documentElement).overflow, `${ON}: the page is locked`).to.equal('hidden');
  await sendKeys({ press: 'Escape' });
  await until(() => !el.hasAttribute('open'), 'closed', 2000);
});

it('a dialog moved from the page into a shadow root in one task still reflects a user open and close there (CONTROL: it lives in that root)', async () => {
  const el = await mount();
  const outer = document.createElement('div');
  document.body.append(outer);
  made.push(outer);
  const root = outer.attachShadow({ mode: 'open' });
  root.append(el);
  await frame();
  expect(el.getRootNode() === root, 'CONTROL: it lives in the shadow root').to.equal(true);
  el.querySelector('[slot="trigger"]').click();
  await until(() => modal(el), `${ON}: open as a modal`, 2000);
  await until(() => el.hasAttribute('open'), `${ON}: the host reflects a user open from its new root`, 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !el.hasAttribute('open'), `${ON}: and a user close`, 2000);
});

it('two copies of the package on one page: a dialog defined from the second copy reflects open and close', async () => {
  const first = await mount();
  if (!customElements.get('x-dialog-two')) defineAs('x-dialog-two');
  expect(customElements.get('x-dialog-two') !== customElements.get('vera-dialog'), 'CONTROL: two classes, from two bundles').to.equal(true);
  const second = await mount(FORM, '', 'x-dialog-two');
  second.querySelector('[slot="trigger"]').click();
  await until(() => modal(second), `${ON}: the second copy's dialog opened`, 2000);
  await until(() => second.hasAttribute('open'), `${ON}: its host reflects open`, 2000);
  await sendKeys({ press: 'Escape' });
  await until(() => !second.hasAttribute('open'), `${ON}: and close`, 2000);
  first.setAttribute('open', '');
  await until(() => modal(first), `${ON}: the first copy's dialog still opens`, 2000);
  first.removeAttribute('open');
  await until(() => !dialogOf(first).open, `${ON}: and closes`, 2000);
});
