/**
 * Does a component with `static styles` actually hydrate, or does it silently re-render?
 *
 * The server cannot put a constructed stylesheet into markup, so `@verajs/styles` serializes one as
 * a `<style vera-styles>` element inside the shadow root. The client, where constructed sheets
 * exist, uses `adoptedStyleSheets` and creates no element — so the shadow root the hydrating
 * renderer adopts begins with a node its template does not describe.
 *
 * A hydration mismatch is **silent by design**: the DOM is repaired in place until it matches the
 * template, so the page looks perfect and the server's work is quietly redone. Only node identity
 * can tell the difference, which is what this asserts — and `static styles` is not an edge case, it is how a
 * component is styled.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, css} from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender, handle } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';
/** List rendering is a module. These suites drive the renderer directly, so they use the
 *  no-registry door rather than `wire([domRender, lists])`. */
import { lists as __lists } from '../../packages/renderer/dist/development/vera-renderer-lists.js';
handle(__lists.fn);

import { adoptStyles } from '../../packages/styles/dist/development/vera-styles.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
wire({ on: 'init', fn: adoptStyles, priority: 50 });

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Exactly what `@verajs/ssr` emits for this component, style element and all. */
const STYLE = `<style vera-styles>.badge { color: teal }</style>`;
const server = (body) => `<template shadowrootmode="open">${STYLE}${body}</template>`;

/**
 * Two shapes, because the renderer may treat them differently: a template with no bindings at all
 * and one with a single attribute binding. A component's styling must not depend on that.
 */
const SHAPES = {
  'no bindings': {
    server: server('<div id="styled"><span class="badge">styled</span></div>'),
    template: () => html`<div id="styled"><span class="badge">styled</span></div>`,
  },
  'one binding': {
    server: server('<div id="styled" style="--x: teal"><span class="badge">styled</span></div>'),
    template: () => html`<div id="styled" style="--x: ${'teal'}"><span class="badge">styled</span></div>`,
  },
};

for (const [name, shape] of Object.entries(SHAPES)) {
  customElements.define(
    `hydrate-styles-${name.replace(/\s/g, '-')}`,
    class extends HTMLElement {
      static styles = css`
        .badge {
          color: teal;
        }
      `;
      connectedCallback() {
        init(this, { mode: 'open' });
        render(shape.template);
      }
    }
  );
}

for (const [name, shape] of Object.entries(SHAPES)) {
  const tag = `hydrate-styles-${name.replace(/\s/g, '-')}`;

  const mount = async () => {
    const host = document.createElement('div');
    host.setHTMLUnsafe(`<${tag}>${shape.server}</${tag}>`);
    document.body.appendChild(host);
    const element = host.firstElementChild;
    expect(element.shadowRoot, 'declarative shadow DOM did not parse').to.exist;
    const before = {
      styled: element.shadowRoot.querySelector('#styled'),
      badge: element.shadowRoot.querySelector('.badge'),
    };
    customElements.upgrade(element);
    await frame();
    await frame();
    return { element, before };
  };

  it(`${name}: adopts the server DOM rather than replacing it`, async () => {
    const { element, before } = await mount();
    expect(
      element.shadowRoot.querySelector('#styled'),
      'the server node was replaced — hydration fell back to a clean render'
    ).to.equal(before.styled);
    expect(element.shadowRoot.querySelector('.badge'), 'the server subtree was rebuilt').to.equal(before.badge);
  });

  it(`${name}: applies the styles exactly once`, async () => {
    const { element } = await mount();
    const root = element.shadowRoot;
    const tags = root.querySelectorAll('style[vera-styles]').length;
    const sheets = root.adoptedStyleSheets.length;
    expect(
      tags + sheets,
      `applied ${tags} time(s) as an element and ${sheets} as a sheet — the same CSS twice`
    ).to.equal(1);
  });
}
