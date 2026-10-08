/**
 * **Unassigned light content is not rendered — measured by LAYOUT, on three engines** (vera-5a, 2026-10-02). Light
 * slots keep unassigned content connected in the host's `<ins hidden data-vm-unassigned>` container, with an inline
 * `display: none !important` beside `hidden`, so an author stylesheet that overrides `[hidden]` (or styles the element
 * by name) cannot make it render. jsdom has no layout and a partial cascade; this is the proof. It also checks the
 * jsdom suites' `shown()` (tests/rendered-text.mjs) against the platform's own `innerText`.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';
import { shown } from '../rendered-text.mjs';

wire([renderer, slots]);

const draw = () => html`<section><slot name="a">fallback</slot></section>`;
const make = (children) => {
  const host = document.createElement('x-unhidden'); // a CUSTOM element, by name: slots captures only those
  host.innerHTML = children;
  document.body.append(host);
  renderInto(draw(), host);
  return host;
};

describe('unassigned light content', () => {
  it('is connected, laid out as nothing, and absent from innerText', () => {
    const host = make('<p slot="a">assigned</p><p slot="nowhere">waiting</p>');
    const waiting = [...host.querySelectorAll('p')].find((p) => p.textContent === 'waiting');
    expect(waiting.isConnected).to.equal(true);
    expect(waiting.getClientRects().length).to.equal(0);
    expect(host.innerText.includes('waiting')).to.equal(false);
    expect(host.innerText.includes('assigned')).to.equal(true, 'CONTROL: the assigned one renders');
    host.remove();
  });

  it('stays unrendered when an author stylesheet overrides [hidden] and the element by name', () => {
    const sheet = document.createElement('style');
    sheet.textContent = 'ins, [data-vm-unassigned], [hidden], :where(*) { display: block !important }';
    document.head.append(sheet);
    const host = make('<p slot="nowhere">waiting</p>');
    const box = host.querySelector('[data-vm-unassigned]');
    expect(box === null).to.equal(false, 'CONTROL: the container exists');
    expect(getComputedStyle(box).display).to.equal('none');
    expect(host.querySelector('p').getClientRects().length).to.equal(0);
    expect(host.innerText.includes('waiting')).to.equal(false);
    sheet.remove();
    host.remove();
  });

  it('agrees with the jsdom suites\' shown() helper', () => {
    const host = make('<p slot="a">one</p>two<p slot="nowhere">three</p>');
    const visible = (text) => text.replace(/\s+/g, '');
    expect(visible(shown(host))).to.equal(visible(host.innerText));
    host.remove();
  });
});
