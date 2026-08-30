/**
 * Custom element **upgrade** — the order the platform actually does it in.
 *
 * `CLAUDE.md` names this as one of the things a fake DOM cannot answer, and it is the ground `init()`
 * stands on: everything VeraJS does begins in `connectedCallback`, which the platform calls at
 * different moments depending on whether the element existed before its definition did.
 *
 * The autoloader exists *because* markup routinely precedes the definition — that is its whole
 * purpose — so "an element that was already on the page when the class arrived" is not an edge case
 * here, it is the common one.
 *
 * Each case records the order things happened rather than only the end state, because the end state
 * is usually right and the ordering is where a framework built on lifecycle callbacks breaks.
 */
import { expect } from '@esm-bundle/chai';
import { init, createStore, render, wire, html } from '../../packages/core/dist/development/vera.js';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';

wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

let seq = 0;
const nextTag = () => `x-upgrade-${seq++}`;

/** A component that records its own lifecycle into `log`, and renders reactive text. */
const defineLogging = (tag, log, options = { mode: 'open' }) => {
  customElements.define(
    tag,
    class extends HTMLElement {
      static get observedAttributes() {
        return ['label'];
      }
      attributeChangedCallback(name, from, to) {
        log.push(`attr ${name}=${to}`);
      }
      connectedCallback() {
        log.push('connected');
        init(this, options);
        const state = createStore({ n: 0 });
        this.bump = () => state.n++;
        render(() => {
          log.push(`render ${state.n}`);
          return html`<i>${this.getAttribute('label') ?? 'none'}:${state.n}</i>`;
        });
      }
      disconnectedCallback() {
        log.push('disconnected');
      }
    }
  );
};

const textOf = (element) => (element.shadowRoot ?? element).textContent.trim();

it('an element already in the document upgrades and renders when its class arrives', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  try {
    /** Markup first, definition second — what the autoloader is for. */
    host.innerHTML = `<${tag} label="early"></${tag}>`;
    const element = host.firstElementChild;
    expect(log, 'nothing should have happened before the definition').to.deep.equal([]);
    expect(element.constructor.name, 'the element should still be unknown').to.equal('HTMLElement');

    defineLogging(tag, log);
    await frame();

    expect(log[0], 'the attribute is delivered before connectedCallback').to.equal('attr label=early');
    expect(log).to.include('connected');
    expect(textOf(element), 'it should have rendered after upgrading').to.equal('early:0');
  } finally {
    host.remove();
  }
});

it('and is reactive afterwards, not merely rendered once', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  try {
    host.innerHTML = `<${tag} label="live"></${tag}>`;
    defineLogging(tag, log);
    await frame();
    const element = host.firstElementChild;
    expect(textOf(element)).to.equal('live:0');
    element.bump();
    await frame();
    expect(textOf(element), 'an upgraded element should still be reactive').to.equal('live:1');
  } finally {
    host.remove();
  }
});

it('an element created before its definition upgrades on insertion', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  try {
    /** Created while unknown, defined, then inserted — a different path through the upgrade rules. */
    const element = document.createElement(tag);
    element.setAttribute('label', 'made-first');
    defineLogging(tag, log);
    host.appendChild(element);
    await frame();
    expect(textOf(element)).to.equal('made-first:0');
  } finally {
    host.remove();
  }
});

/**
 * The ordering that matters most for a framework whose components nest: the platform upgrades a tree
 * **outermost first**, so a parent's `connectedCallback` runs before its children exist as components.
 * A parent that reads its children during setup is reading them before they have upgraded.
 */
it('a nested tree upgrades outermost first', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const outer = nextTag();
  const inner = nextTag();
  const order = [];
  try {
    /** **Both defined before the markup exists.** Defining `inner` first would upgrade an existing
     * inner element immediately, before `outer` was even a component — which is a different rule and
     * was how this test read 'inner' first on its first run. */
    customElements.define(
      inner,
      class extends HTMLElement {
        connectedCallback() {
          order.push('inner');
          init(this, { mode: 'open' });
          render(() => html`<i>in</i>`);
        }
      }
    );
    customElements.define(
      outer,
      class extends HTMLElement {
        connectedCallback() {
          order.push('outer');
          /** What a parent sees of its child at setup time. */
          order.push(`child upgraded: ${host.querySelector(inner) instanceof customElements.get(inner)}`);
          init(this);
          render(() => html`<slot></slot>`);
        }
      }
    );
    host.innerHTML = `<${outer}><${inner}></${inner}></${outer}>`;
    await frame();
    expect(order[0], 'the platform upgrades a tree outermost first').to.equal('outer');
    expect(order, 'both should have upgraded').to.include('inner');
  } finally {
    host.remove();
  }
});

/**
 * An element removed before the frame its first render was scheduled on. The render is queued
 * against an element that is no longer in the document, which is exactly the case a scheduler that
 * does not check can paint into nothing — or throw.
 */
it('an element removed before its first render neither throws nor renders', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  const problems = [];
  const onError = (event) => problems.push(String(event.message ?? event.reason));
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onError);
  try {
    defineLogging(tag, log);
    const element = document.createElement(tag);
    host.appendChild(element);
    /** Synchronously, before the scheduled frame. */
    element.remove();
    await frame();
    await frame();
    expect(problems, 'removing before the first render threw').to.deep.equal([]);
    expect(log).to.include('connected');
    expect(log).to.include('disconnected');
  } finally {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onError);
    host.remove();
  }
});

/**
 * Reconnection. `disconnectedCallback` runs the element's cleanups and clears them, so a component
 * that is moved or re-inserted has to set itself up again — the platform calls `connectedCallback`
 * a second time, and `init()` has to cope with being called twice on one element.
 */
it('a component survives being removed and re-inserted', async () => {
  const host = document.createElement('div');
  const other = document.createElement('div');
  document.body.append(host, other);
  const tag = nextTag();
  const log = [];
  try {
    defineLogging(tag, log);
    const element = document.createElement(tag);
    element.setAttribute('label', 'moved');
    host.appendChild(element);
    await frame();
    expect(textOf(element)).to.equal('moved:0');

    element.remove();
    await frame();
    other.appendChild(element);
    await frame();

    expect(log.filter((l) => l === 'connected').length, 'connectedCallback should have run twice').to.equal(2);
    expect(textOf(element), 'it should have rendered again after re-insertion').to.equal('moved:0');

    /** And still be reactive on the second life, which is what a lost setup would break. */
    element.bump();
    await frame();
    expect(textOf(element), 'a re-inserted component stopped being reactive').to.equal('moved:1');
  } finally {
    host.remove();
    other.remove();
  }
});

/** An attribute set while the element was unknown must still reach `attributeChangedCallback`. */
it('attributes set before upgrade are delivered at upgrade', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  try {
    const element = document.createElement(tag);
    element.setAttribute('label', 'set-while-unknown');
    host.appendChild(element);
    expect(log, 'nothing runs before the definition').to.deep.equal([]);
    defineLogging(tag, log);
    await frame();
    expect(log[0]).to.equal('attr label=set-while-unknown');
    expect(textOf(element)).to.equal('set-while-unknown:0');
  } finally {
    host.remove();
  }
});

/** Many instances of one component, upgraded together, must each get their own state. */
it('instances upgraded together do not share state', async () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const tag = nextTag();
  const log = [];
  try {
    host.innerHTML = Array.from({ length: 5 }, (_, i) => `<${tag} label="i${i}"></${tag}>`).join('');
    defineLogging(tag, log);
    await frame();
    const elements = [...host.children];
    elements[2].bump();
    elements[2].bump();
    await frame();
    expect(elements.map(textOf)).to.deep.equal(['i0:0', 'i1:0', 'i2:2', 'i3:0', 'i4:0']);
  } finally {
    host.remove();
  }
});
