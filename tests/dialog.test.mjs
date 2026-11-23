/**
 * **<vera-dialog> over the author's own `<dialog>`**, through its real bundle in jsdom: the wiring it sets at connect (the
 * dialog's part and id, its name from a heading or a title part, its description, the trigger's invoker attributes),
 * what it keeps of the author's, what it warns (once, with a code), and two instances' ids. jsdom has `<dialog>` with no
 * `showModal`, so opening, closing, focus and dismissal are an engine's to answer: `tests/browser/dialog.test.js`. Runs
 * against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { isProduction, load } from './dist.mjs';

/** The net's named limit: jsdom cannot parse some CSS an engine accepts (@starting-style, :has, allow-discrete). */
const said = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('error', (...args) => said.push(String(args[0])));
virtualConsole.on('warn', (...args) => said.push(String(args[0])));
virtualConsole.on('jsdomError', (error) => {
  if (!/^Could not parse CSS stylesheet/.test(error.message)) said.push(String(error.stack ?? error));
});
console.warn = (...args) => said.push(String(args[0]));
console.error = (...args) => said.push(String(args[0]));

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true, virtualConsole });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLDialogElement', 'HTMLButtonElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'KeyboardEvent', 'MouseEvent', 'MutationObserver', 'getComputedStyle'])
  globalThis[key] = dom.window[key];
const doc = dom.window.document;

const { flush } = await load('core');
await load('vera-components/dialog');

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const FORM = '<button slot="trigger">Edit</button><dialog><h2>Edit profile</h2><form method="dialog"><button value="save">Save</button></form></dialog>';
const mount = async (inner = FORM, attributes = '') => {
  const holder = doc.createElement('div');
  holder.innerHTML = `<vera-dialog ${attributes}>${inner}</vera-dialog>`;
  doc.body.append(holder);
  await settle();
  return holder.firstElementChild;
};
const drop = (el) => el.parentElement.remove();
const dialogOf = (el) => el.querySelector(':scope > dialog');
/** A development warning said exactly once, naming its code; production says nothing. */
const saidOnce = (code) => {
  const lines = said.splice(0);
  if (isProduction) return assert.deepEqual(lines, [], 'production: nothing said');
  assert.equal(lines.length, 1, lines.join(' | '));
  assert.match(lines[0], code);
  assert.match(lines[0], /^\[vera\] /);
};

test('at connect: the dialog is marked and named by its heading, the trigger is its invoker, and nothing is said', async () => {
  const el = await mount();
  const dialog = dialogOf(el);
  const trigger = el.querySelector('[slot="trigger"]');
  const heading = dialog.querySelector('h2');
  assert.equal(dialog.getAttribute('data-vera-part'), 'dialog');
  assert.ok(dialog.id !== '' && heading.id !== '', 'ids minted');
  assert.equal(dialog.getAttribute('aria-labelledby'), heading.id);
  assert.equal(trigger.getAttribute('commandfor'), dialog.id);
  assert.equal(trigger.getAttribute('command'), 'show-modal');
  assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(dialog.hasAttribute('open'), false, 'not opened by connecting');
  assert.deepEqual(said.splice(0), []);
  drop(el);
});

test('a title part names it and a description part describes it; an author\'s label, ids and invoker attributes are kept', async () => {
  const el = await mount('<dialog><p data-vera-part="title">Filters</p><p data-vera-part="description">Narrow the list.</p></dialog>');
  const dialog = dialogOf(el);
  assert.equal(dialog.getAttribute('aria-labelledby'), dialog.querySelector('[data-vera-part="title"]').id);
  assert.equal(dialog.getAttribute('aria-describedby'), dialog.querySelector('[data-vera-part="description"]').id);
  const own = await mount('<button slot="trigger" commandfor="other" command="toggle">Go</button><dialog id="d1" aria-label="Mine"><h2>Heading</h2></dialog>');
  assert.equal(dialogOf(own).id, 'd1');
  assert.equal(dialogOf(own).getAttribute('aria-label'), 'Mine');
  assert.equal(dialogOf(own).hasAttribute('aria-labelledby'), false, 'an aria-label stands');
  assert.equal(own.querySelector('[slot="trigger"]').getAttribute('commandfor'), 'other');
  assert.equal(own.querySelector('[slot="trigger"]').getAttribute('command'), 'toggle');
  assert.deepEqual(said.splice(0), []);
  drop(el);
  drop(own);
});

test('dismiss="outside" sets closedby only where the engine has it, and never on an alertdialog (CONTROL: jsdom has none)', async () => {
  assert.equal('closedBy' in dom.window.HTMLDialogElement.prototype, false, 'CONTROL: jsdom has no closedby');
  const el = await mount(FORM, 'dismiss="outside"');
  assert.equal(dialogOf(el).hasAttribute('closedby'), false, 'the fallback handles it here');
  drop(el);
});

test('the host\'s open in a DOM with no showModal mounts and says nothing (an app\'s own jsdom tests)', async () => {
  const el = await mount(FORM, 'open');
  assert.equal(el.getAttribute('open'), '');
  assert.deepEqual(said.splice(0), []);
  drop(el);
});

test('it warns once, with a code: no dialog, an unnamed dialog, an alertdialog without autofocus or description', async () => {
  for (const [inner, code] of [
    ['<button slot="trigger">Go</button>', /dialog-no-dialog/],
    ['<dialog><p>No name.</p></dialog>', /dialog-no-label/],
    ['<dialog role="alertdialog"><h2>Delete?</h2><p data-vera-part="description">Gone for good.</p><button>OK</button></dialog>', /dialog-alert-no-autofocus/],
    ['<dialog role="alertdialog"><h2>Delete?</h2><button autofocus>Cancel</button></dialog>', /dialog-alert-no-description/],
  ]) {
    const el = await mount(inner);
    saidOnce(code);
    drop(el);
  }
});

test('two instances mint distinct ids', async () => {
  const [a, b] = [await mount(), await mount()];
  assert.notEqual(dialogOf(a).id, dialogOf(b).id);
  assert.notEqual(dialogOf(a).querySelector('h2').id, dialogOf(b).querySelector('h2').id);
  drop(a);
  drop(b);
});
