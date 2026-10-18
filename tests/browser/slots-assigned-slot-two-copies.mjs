/**
 * Shared by the two install-order files: TWO independent copies of core + renderer + slots on one page — two apps, as
 * micro-frontends are — each its own registry, each installing its own `assignedSlot` getter at its first light host.
 * `first` says which copy's host appears first (whose getter the other one then wraps).
 */
import { expect } from '@esm-bundle/chai';

const copy = async (n) => {
  const core = await import(`../../packages/core/dist/vera.min.js?copy=${n}`);
  const { renderer } = await import(`../../packages/renderer/dist/vera-renderer.min.js?copy=${n}`);
  const { slots } = await import(`../../packages/renderer/dist/vera-renderer-slots.min.js?copy=${n}`);
  core.wire([renderer, slots]);
  const tag = `as-copy-${n}`;
  const refs = {};
  customElements.define(tag, class extends HTMLElement {
    connectedCallback() { core.init(this, () => () => core.html`<header><slot name="h" &ref=${(el) => { if (el) refs.slot = el; }}>fh</slot></header>`); }
  });
  return { core, tag, refs };
};

export const run = async (first) => {
  const proto = { Element: Object.getOwnPropertyDescriptor(Element.prototype, 'assignedSlot'), Text: Object.getOwnPropertyDescriptor(Text.prototype, 'assignedSlot') };
  expect(typeof proto.Element?.get === 'function', 'CONTROL: this engine defines an assignedSlot getter on Element.prototype').to.equal(true);
  expect(typeof proto.Text?.get === 'function', 'CONTROL: and on Text.prototype').to.equal(true);
  const copies = [await copy(1), await copy(2)];
  const order = first === 1 ? copies : [copies[1], copies[0]];
  const made = [];
  for (const { core, tag, refs } of order) {
    const host = document.createElement(tag);
    const b = document.createElement('b');
    b.setAttribute('slot', 'h');
    host.append(b);
    document.body.append(host);
    core.flush();
    await new Promise((resolve) => setTimeout(resolve, 20));
    made.push({ host, b, refs });
  }
  for (const { b, refs } of made) expect(b.assignedSlot === refs.slot && refs.slot !== undefined, 'each copy answers for the node it placed').to.equal(true);
  const loose = document.createElement('p');
  expect(loose.assignedSlot === null, 'a node neither copy placed reads the native null').to.equal(true);
  for (const { host } of made) host.remove();
};
