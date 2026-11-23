/**
 * **Components that own their children keep them on a page that wires slots.** `<vera-tabs>`, `<vera-menu>` and
 * `<vera-dialog>` render no `<slot>` and wire the author's own nodes in place, several of them marked `slot="…"`
 * (`tabs`, `menu`, `trigger`). Each declares `ownsChildren`, so light slots, wired on the page, leaves every authored
 * child where it was written: the same nodes, in the same order, directly under the host, and nothing said. The
 * control: an ordinary light host on the same page that renders a `<slot>` still has its child distributed, so slots
 * is wired and working. In its own process (wire is global). Runs against both builds.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM, VirtualConsole } from 'jsdom';
import { load } from './dist.mjs';

/** The net's named limit: jsdom cannot parse some CSS an engine accepts (anchor positioning, @scope). */
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
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'ShadowRoot', 'MutationObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent'])
  globalThis[key] = dom.window[key];
const doc = dom.window.document;

const { init, html, wire, flush } = await load('core');
const { renderer } = await load('renderer');
const { slots } = await load('renderer/slots');
wire([renderer, slots]);
await load('vera-components/tabs');
await load('vera-components/menu');
await load('vera-components/dialog');

/** The control: an ordinary light slots host, its default slot filled from the author's children. */
customElements.define('own-children-control', class extends HTMLElement {
  connectedCallback() {
    init(this, () => () => html`<main><slot></slot></main>`);
  }
});

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};
const mount = async (tag, inner) => {
  const holder = doc.createElement('div');
  holder.innerHTML = `<${tag}>${inner}</${tag}>`;
  doc.body.append(holder);
  const host = holder.firstElementChild;
  const authored = [...host.children];
  await settle();
  return { host, authored };
};

const CASES = {
  'vera-tabs':
    '<div slot="tabs"><button type="button" value="a">A</button><button type="button" value="b">B</button></div>' +
    '<section data-value="a">Pa</section><section data-value="b">Pb</section>',
  'vera-menu': '<button slot="trigger">Actions</button><div slot="menu"><button value="rename">Rename</button><button value="copy">Copy</button></div>',
  'vera-dialog': '<button slot="trigger">Edit</button><dialog><h2>Edit profile</h2><form method="dialog"><button value="save">Save</button></form></dialog>',
};

test('CONTROL: slots is wired: an ordinary light host on this page has its children distributed into its slot', async () => {
  said.length = 0;
  const { host } = await mount('own-children-control', '<b>one</b><b>two</b>');
  assert.equal(host.querySelectorAll('main b').length, 2, 'both children distributed into the slot position');
  assert.deepEqual(said, []);
  host.parentNode.remove();
});

for (const [tag, inner] of Object.entries(CASES))
  test(`${tag} on a page that wires slots keeps every authored child where it was written, and says nothing`, async () => {
    said.length = 0;
    const { host, authored } = await mount(tag, inner);
    assert.ok(authored.length >= 2, 'the case authors several children');
    assert.deepEqual(
      [...host.children].filter((el) => authored.includes(el)),
      authored,
      `${tag}: its authored children are still its direct children, the same nodes in the same order`,
    );
    assert.equal(host.querySelector('[data-vm-unassigned]'), null, `${tag}: nothing of its own was set aside as unassigned`);
    assert.deepEqual(said, [], `${tag}: nothing was said`);
    host.parentNode.remove();
  });
