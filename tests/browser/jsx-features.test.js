/**
 * **The three JSX features, compiled and rendered by a real engine.**
 *
 * Every other execution test for them is jsdom, which `CLAUDE.md` calls the regression net and
 * never the oracle "for anything the platform decides" — and two of the three are exactly that:
 * an SVG element's namespace is decided by the parser, and a property landing on a custom element
 * depends on upgrade timing. The third, a boolean child, is engine-independent but rides along
 * because the same page proves all three at once.
 *
 * The transform runs HERE, in the browser, from the same entry `@verajs/jsx/standalone` uses — so
 * this is the compiler and the renderer meeting with no toolchain between them, which is also the
 * buildless story's only end-to-end check of the new rules.
 */
import { expect } from '@esm-bundle/chai';
import { transformJsx } from '../../packages/jsx/dist/development/vera-jsx.js';
import { html, wire, init, render } from '../../packages/core/dist/development/vera.js';
import { renderer, renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';

wire([renderer]);

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Compile a JSX expression in the browser and import the result, exactly as standalone does. */
const compile = async (source) => {
  const js = transformJsx(source, 'feature.jsx', { inject: false });
  const blob = new Blob([`const { html, svg, mathml } = globalThis.__jsxScope;\n${js}`], {
    type: 'text/javascript',
  });
  const url = URL.createObjectURL(blob);
  try {
    return await import(/* @vite-ignore */ url);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const mount = () => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  return host;
};

before(async () => {
  const core = await import('../../packages/core/dist/development/vera.js');
  globalThis.__jsxScope = { html: core.html, svg: core.svg, mathml: core.mathml };
});

it('shapes mapped inside <svg> are real SVGElements, in this engine', async () => {
  const mod = await compile(
    'export const icon = (pts) => <svg viewBox="0 0 10 10">{pts.map((p) => <circle cx={p} cy="5" r="1" />)}</svg>;'
  );
  const host = mount();
  renderInto(mod.icon([1, 2, 3]), host);

  const circles = [...host.querySelectorAll('circle')];
  expect(circles.length, 'the mapped shapes rendered').to.equal(3);
  for (const circle of circles) {
    expect(circle.namespaceURI, 'parsed in the SVG namespace').to.equal('http://www.w3.org/2000/svg');
    /**
     * The namespace is what the whole fix is for, and `instanceof SVGElement` is the property that
     * actually decides whether it draws — an `HTMLUnknownElement` has the right tag name and no
     * geometry at all, which is why the original report said the shapes "don't draw".
     */
    expect(circle instanceof SVGElement, 'and is a real SVG element, not HTMLUnknown').to.equal(true);
  }
  host.remove();
});

it('<foreignObject> flips back to HTML inside the same tree', async () => {
  const mod = await compile(
    'export const v = (t) => <svg><foreignObject><div>{t && <em>in html</em>}</div></foreignObject></svg>;'
  );
  const host = mount();
  renderInto(mod.v(true), host);
  const em = host.querySelector('em');
  expect(em, 'the element rendered').to.not.equal(null);
  expect(em.namespaceURI, 'inside foreignObject it is HTML again').to.equal('http://www.w3.org/1999/xhtml');
  host.remove();
});

it('a bare prop on a dash-named tag arrives as a property, reactively', async () => {
  customElements.define(
    'jsx-feature-child',
    class extends HTMLElement {
      connectedCallback() {
        init(this, { mode: 'open' });
        render(() => html`<p>${this.item ? this.item.label : 'none'} / ${String(this.count)}</p>`);
      }
    }
  );
  const mod = await compile(
    'export const v = (s) => <jsx-feature-child item={s.item} count={s.count} />;'
  );
  const host = mount();
  renderInto(mod.v({ item: { label: 'alpha' }, count: 1 }), host);
  await frame();
  await frame();

  const child = host.querySelector('jsx-feature-child');
  const text = () => child.shadowRoot.querySelector('p').textContent.replace(/\s+/g, ' ').trim();
  expect(text(), 'the object arrived by identity, not stringified').to.equal('alpha / 1');

  renderInto(mod.v({ item: { label: 'beta' }, count: 2 }), host);
  await frame();
  await frame();
  expect(text(), 'and the parent’s next render updates the adopted props').to.equal('beta / 2');
  host.remove();
});

it('a boolean child renders nothing, and only a boolean', async () => {
  const mod = await compile(
    'export const v = (s) => <b>[{s.f && <i>x</i>}][{s.t && <i>y</i>}][{s.zero && <i>z</i>}]</b>;'
  );
  const host = mount();
  renderInto(mod.v({ f: false, t: true, zero: 0 }), host);
  expect(host.querySelector('b').textContent, 'false drops; true renders; 0 still renders').to.equal('[][y][0]');
  host.remove();
});
