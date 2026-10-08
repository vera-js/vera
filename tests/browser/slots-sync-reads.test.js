/**
 * **Layout read in the same task as the render that re-slotted it** — on the engines, because layout is theirs.
 *
 * Slots keeps an observer pair per light host (Gecko's `observe()` is linear in a shared observer's registrations), and
 * a render's end reads the records of the light hosts that render's templates created. So an OUTER template changing a
 * component's light children is distributed by the end of that render: code measuring the slotted content right after
 * it — a layout effect, `getBoundingClientRect`, `offsetTop` — sees the new assignment, not the old one.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto, renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { slots } from '../../packages/renderer/dist/development/vera-renderer-slots.js';
import { html, wire } from '../../packages/core/dist/development/vera.js';

wire([renderer, slots]);
const card = () => html`<header style="display:block;height:40px"><slot name="h">FH</slot></header><main style="display:block;height:40px"><slot>FD</slot></main>`;

it('an outer render re-slots a light child: its position is read in the new slot in the same task', () => {
  const page = document.createElement('div');
  document.body.appendChild(page);
  const draw = (name) => html`<x-sync-layout style="display:block"><b slot=${name} style="display:block">B</b></x-sync-layout>`;
  renderInto(draw('h'), page);
  const inner = page.querySelector('x-sync-layout');
  renderInto(card(), inner);
  const b = inner.querySelector('b');
  const header = inner.querySelector('header');
  const main = inner.querySelector('main');
  expect(b.parentNode === header).to.equal(true, 'CONTROL: in the named slot first');
  expect(Math.abs(b.getBoundingClientRect().top - header.getBoundingClientRect().top) < 1).to.equal(true, 'CONTROL: laid out there');
  renderInto(draw(''), page);
  expect(b.parentNode === main).to.equal(true, 'the same task reads it in the default slot');
  expect(Math.abs(b.getBoundingClientRect().top - main.getBoundingClientRect().top) < 1).to.equal(true, 'and its layout position is the default slot\'s');
  expect(b.offsetTop >= header.offsetHeight).to.equal(true, `offsetTop ${b.offsetTop} is below the 40px header`);
  page.remove();
});
