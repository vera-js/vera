/**
 * **Where frames never come, the scheduler still runs — in a real engine.** A hidden tab has no animation frames, and
 * the scheduler's fallback is the element window's next frame OR a ~100 ms timer, whichever comes first (Brian,
 * 2026-10-08). jsdom cannot show a hidden tab, so this stands one in: `requestAnimationFrame` replaced by one that
 * never calls back. Two properties: a one-off update still lands inside a microtask (it never waits on a frame at all),
 * and a self-feeding loop — whose third run in a flush is held for a frame — still settles, through the timer.
 */
import { expect } from '@esm-bundle/chai';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html, wire, init, render, useEffect, createStore } from '../../packages/core/dist/development/vera.js';

wire([renderer]);

/** Frames that never arrive, for the length of `work`. */
const withoutFrames = async (work) => {
  const real = window.requestAnimationFrame;
  let asked = 0;
  window.requestAnimationFrame = () => ++asked;
  try {
    await work();
  } finally {
    window.requestAnimationFrame = real;
  }
  return asked;
};

const state = createStore({ n: 0, loop: 0, until: 0 });
let effects = 0;
customElements.define('x-no-frames', class extends HTMLElement {
  connectedCallback() {
    init(this);
    useEffect(() => {
      void state.n;
      effects++;
    });
    useEffect(() => {
      if (state.loop > 0 && state.loop < state.until) state.loop++;
    });
    render(() => html`<p>${state.n}</p><b>${state.loop}</b>`);
  }
});
const element = document.createElement('x-no-frames');
document.body.append(element);

it('a one-off update lands in a microtask, and its effect runs, with no frame ever arriving', async () => {
  const before = effects;
  await withoutFrames(async () => {
    state.n = 1;
    await Promise.resolve();
    expect(element.querySelector('p').textContent).to.equal('1', 'the render landed');
    expect(effects).to.equal(before + 1, 'and the effect ran — no frame, no timer');
  });
});

it('a held self-feeding loop still settles, through the timer, with no frame ever arriving', async () => {
  const asked = await withoutFrames(async () => {
    state.until = 6;
    state.loop = 1;
    await Promise.resolve();
    expect(state.loop).to.equal(3, 'the effect ran twice in the flush, then its third run was held');
    expect(element.querySelector('b').textContent).to.equal('2', 'and the render too: its third run waits with it');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(element.querySelector('b').textContent).to.equal('6', 'the held runs came back on the timer');
  });
  expect(asked).to.be.at.least(1, 'CONTROL: it did ask for a frame — the timer is the fallback, not the path');
});
