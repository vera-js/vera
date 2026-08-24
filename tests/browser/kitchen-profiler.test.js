/**
 * `@verajs/renderer/profiler`, on a real application.
 *
 * The profiler exists to make one rule **visible**: rendering the same element every pass and
 * toggling `hidden` keeps template identity, while swapping one subtree for another tears it down
 * and rebuilds it — identical from the outside, and the difference between an update and a rebuild.
 * A tool that measures that has to be measured itself, against a page whose churn is known.
 *
 * It is a drop-in entry that re-exports the whole renderer API, so it is wired exactly as the plain
 * one is and the application never knows.
 */
import { expect } from '@esm-bundle/chai';
import { setRenderer, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import {
  render as profilingRender,
  profile,
  formatReport,
  startProfiling,
  stopProfiling,
  isProfiling,
} from '../../packages/renderer/dist/development/vera-renderer-profiler.js';

setRenderer(profilingRender);
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** The shape the docs call fragile: two sibling parts swapping between a template and nothing. */
customElements.define(
  'profiler-churn',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ editing: false });
      this.state = state;
      render(() =>
        state.editing
          ? html`<div><input id="editor" /></div>`
          : html`<section><output id="viewer">v</output></section>`
      );
    }
  }
);

/** The shape it recommends: one template, visibility toggled. */
customElements.define(
  'profiler-stable',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ editing: false });
      this.state = state;
      render(
        () => html`<div>
          <input id="editor" ?hidden=${!state.editing} />
          <output id="viewer" ?hidden=${state.editing}>v</output>
        </div>`
      );
    }
  }
);

const mount = async (tag) => {
  const element = document.createElement(tag);
  document.body.appendChild(element);
  await frame();
  return element;
};

const toggle = async (element, times) => {
  for (let i = 0; i < times; i++) {
    element.state.editing = !element.state.editing;
    await frame();
  }
};

it('counts a subtree that was rebuilt rather than updated', async () => {
  const churn = await mount('profiler-churn');
  const { report } = await profile(async () => {
    await toggle(churn, 4);
  });
  expect(report.rebuilds, 'swapping one template for another must register as a rebuild').to.be.greaterThan(0);
  expect(report.churn.length, 'and the report must say which templates').to.be.greaterThan(0);
  expect(formatReport(report), 'the formatted report should name the churn').to.contain('rebuilt');
});

it('a stable shape updates in place instead', async () => {
  const stable = await mount('profiler-stable');
  const { report } = await profile(async () => {
    await toggle(stable, 4);
  });
  expect(report.rebuilds, 'a stable shape must not rebuild anything').to.equal(0);
  expect(report.updates, 'it should be updating in place').to.be.greaterThan(0);
});

it('starts and stops, and says which it is', async () => {
  expect(isProfiling()).to.equal(false);
  startProfiling();
  expect(isProfiling()).to.equal(true);
  const stable = await mount('profiler-stable');
  await toggle(stable, 2);
  const report = stopProfiling();
  expect(isProfiling()).to.equal(false);
  expect(report.frames, 'a report needs the frames it covered').to.be.greaterThan(0);
});
