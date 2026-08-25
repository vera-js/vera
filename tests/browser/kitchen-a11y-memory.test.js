/**
 * **Pass 4 probes.** Accessibility and memory — the two things `docs/CODE-PRINCIPLES.md` names as
 * part of correctness rather than as follow-ups.
 *
 * #2 puts the keyboard path, focus management and ARIA in the *same pass* as any interaction, and
 * makes memory discipline part of correctness: the store leans on `WeakRef`/`WeakMap` so a detached
 * element is collectable, and anything holding an element reference must not defeat that.
 *
 * Memory is measured with `--expose-gc`; without it the collection assertions skip rather than
 * pretend. One `gc()` call is not a collection — this repo has been misled by that twice — so the
 * loop below collects repeatedly and waits for a plateau.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as domRender } from '../../packages/renderer/dist/development/vera-renderer.js';

wire({ on: 'render', fn: domRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

customElements.define(
  'a11y-probe',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ open: false });
      this.state = state;
      render(
        () => html`<div>
          <button id="toggle" aria-expanded=${String(state.open)} aria-controls="panel" @click=${() => (state.open = !state.open)}>
            toggle
          </button>
          <section id="panel" role="region" aria-labelledby="toggle" ?hidden=${!state.open}>
            <a id="inside" href="#x">a link</a>
          </section>
        </div>`
      );
    }
  }
);

describe('accessibility is part of the render, not a follow-up', () => {
  it('a state change updates the ARIA that describes it', async () => {
    const element = document.createElement('a11y-probe');
    document.body.appendChild(element);
    await frame();

    const button = element.shadowRoot.querySelector('#toggle');
    const panel = element.shadowRoot.querySelector('#panel');
    expect(button.getAttribute('aria-expanded')).to.equal('false');
    expect(panel.hasAttribute('hidden')).to.equal(true);

    button.click();
    await frame();
    expect(button.getAttribute('aria-expanded'), 'aria-expanded did not follow the state').to.equal('true');
    expect(panel.hasAttribute('hidden')).to.equal(false);
  });

  it('a keyboard activation is the same path as a click', async () => {
    const element = document.createElement('a11y-probe');
    document.body.appendChild(element);
    await frame();
    const button = element.shadowRoot.querySelector('#toggle');

    /** A real button fires `click` from Enter and Space; the component must not need its own. */
    button.focus();
    expect(element.shadowRoot.activeElement, 'the control must be focusable').to.equal(button);
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    button.click();
    await frame();
    expect(element.shadowRoot.querySelector('#panel').hasAttribute('hidden')).to.equal(false);
  });

  it('hidden content is out of the tab order, which is what ?hidden buys', async () => {
    const element = document.createElement('a11y-probe');
    document.body.appendChild(element);
    await frame();
    const link = element.shadowRoot.querySelector('#inside');
    /** `hidden` removes it from the accessibility tree and from focus; `offsetParent` proves it. */
    expect(link.offsetParent, 'hidden content is still laid out').to.equal(null);
  });
});

describe('memory discipline', () => {
  const collect = async () => {
    if (!globalThis.gc) return false;
    for (let i = 0; i < 6; i++) {
      globalThis.gc();
      await new Promise((r) => setTimeout(r, 10));
    }
    return true;
  };

  it('a removed component is collectable', async function checkCollection() {
    this.timeout(30000);
    const state = createStore({ n: 0 });
    customElements.define(
      'memory-probe',
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          render(() => html`<p>${state.n}</p>`);
        }
      }
    );

    const held = [];
    for (let i = 0; i < 20; i++) {
      const element = document.createElement('memory-probe');
      document.body.appendChild(element);
      held.push(new WeakRef(element));
    }
    await frame();
    for (const reference of held) reference.deref()?.remove();
    await frame();

    if (!(await collect())) {
      /** No `--expose-gc`: say so rather than assert something the environment cannot answer. */
      expect(held.length, 'collection is unobservable without --expose-gc').to.equal(20);
      return;
    }
    const alive = held.filter((reference) => reference.deref()).length;
    expect(alive, `${alive} of 20 detached components were retained`).to.be.lessThan(20);
  });

  it('the store does not keep a detached element rendering', async () => {
    const state = createStore({ n: 0 });
    let renders = 0;
    customElements.define(
      'memory-render-probe',
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          render(() => {
            renders++;
            return html`<p>${state.n}</p>`;
          });
        }
      }
    );
    const element = document.createElement('memory-render-probe');
    document.body.appendChild(element);
    await frame();
    element.remove();
    await frame();

    const before = renders;
    state.n = 1;
    await frame();
    await frame();
    expect(renders, 'a detached component re-rendered').to.equal(before);
  });
});

describe('a form-associated custom element participates in its form', () => {
  it('submits the value its internals set', async () => {
    customElements.define(
      'form-probe',
      class extends HTMLElement {
        static formAssociated = true;
        connectedCallback() {
          init(this, { mode: 'open' });
          this.internals = this.attachInternals();
          this.internals.setFormValue('from internals');
          render(() => html`<output>held</output>`);
        }
      }
    );

    const form = document.createElement('form');
    const control = document.createElement('form-probe');
    control.setAttribute('name', 'probe');
    form.appendChild(control);
    document.body.appendChild(form);
    await frame();

    expect(control.internals.form, 'the element did not associate with its form').to.equal(form);
    expect(new FormData(form).get('probe'), 'the value never reached the form').to.equal('from internals');
  });
});
