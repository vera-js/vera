/**
 * **What `:scope` matches when a query starts from a node that is not an element** — a shadow root or a document
 * fragment. The engines decide it, so they are the oracle (jsdom is not, for anything the platform decides), and the
 * SSR shim's `select.ts` follows what is recorded here. `:scope` from an ELEMENT is the control: it must match, or a
 * row of zeros would mean nothing.
 */
import { expect } from '@esm-bundle/chai';

const shadow = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = '<b></b><p><b></b></p>';
  return root;
};
const fragment = () => {
  const template = document.createElement('template');
  template.innerHTML = '<b></b><p><b></b></p>';
  return template.content.cloneNode(true);
};

it('control: :scope from an element is that element', () => {
  const div = document.createElement('div');
  div.innerHTML = '<b></b><p><b></b></p>';
  expect(div.querySelectorAll(':scope > b').length).to.equal(1);
  expect(div.querySelectorAll(':scope b').length).to.equal(2);
});

it(':scope from a shadow root or a fragment matches no element', () => {
  for (const [label, make] of [['shadow root', shadow], ['fragment', fragment]]) {
    expect(make().querySelectorAll(':scope > b').length, `${label}: :scope > b`).to.equal(0);
    expect(make().querySelectorAll(':scope b').length, `${label}: :scope b`).to.equal(0);
    expect(make().querySelectorAll(':scope').length, `${label}: :scope`).to.equal(0);
  }
});
