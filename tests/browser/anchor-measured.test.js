/**
 * **`@vera-hooks/anchor`'s measured path in real engines** (sheets/hook-anchor.md, principle 8). jsdom has no layout, so
 * every row here is a browser row: the layer must sit where `place()` says, measured by `getBoundingClientRect()` on
 * both elements, within 1px.
 */
import { expect } from '@esm-bundle/chai';
import { anchor } from '../../packages/hooks/anchor/dist/development/vera-anchor.js';

const frames = (n = 2) => new Promise((resolve) => {
  const step = () => (--n <= 0 ? resolve() : requestAnimationFrame(step));
  requestAnimationFrame(step);
});
const near = (a, b, what) => expect(Math.abs(a - b) <= 1, `${what}: ${a} vs ${b}`).to.equal(true);

/** A 100x30 target at (left, top) inside `parent`, and a 120x80 layer in the body. */
const fixture = (parent, left, top, targetStyle = '') => {
  const target = document.createElement('button');
  target.style.cssText = `position: absolute; left: ${left}px; top: ${top}px; width: 100px; height: 30px; ${targetStyle}`;
  parent.append(target);
  const layer = document.createElement('div');
  layer.style.cssText = 'width: 120px; height: 80px; background: #ccc;';
  document.body.append(layer);
  return { target, layer };
};

let cleanup = [];
afterEach(() => {
  for (const undo of cleanup.splice(0)) undo();
});
const holder = (css = '') => {
  const div = document.createElement('div');
  div.style.cssText = `position: relative; ${css}`;
  document.body.prepend(div);
  cleanup.push(() => div.remove());
  return div;
};

describe('anchor, measured path', () => {
  it('places synchronously in open(): under the target, left edges aligned, before any frame', () => {
    const { target, layer } = fixture(holder('height: 200px'), 40, 20);
    cleanup.push(() => layer.remove());
    const placed = anchor(layer, target);
    placed.open();
    const t = target.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    near(l.top, t.bottom + 4, 'top');
    near(l.left, t.left, 'left');
    expect(layer.getAttribute('data-placement')).to.equal('bottom');
    placed.close();
  });

  it('flips above when the room below is short', () => {
    const { target, layer } = fixture(holder(`height: ${innerHeight}px`), 40, innerHeight - 50);
    cleanup.push(() => layer.remove());
    const placed = anchor(layer, target);
    placed.open();
    expect(layer.getAttribute('data-placement')).to.equal('top');
    near(layer.getBoundingClientRect().bottom, target.getBoundingClientRect().top - 4, 'bottom edge');
    placed.close();
  });

  it('corrects for a translated and scaled containing block', () => {
    const card = holder('height: 300px; transform: translate(37px, 11px) scale(0.5); transform-origin: 0 0');
    const { target, layer } = fixture(card, 40, 20);
    card.append(layer); // inside the transformed ancestor, so fixed positioning is relative to it
    const placed = anchor(layer, target);
    placed.open();
    const t = target.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    near(l.top, t.bottom + 4, 'top through the scale');
    near(l.left, t.left, 'left through the translation');
    placed.close();
  });

  it("follows a scroller inside a user's shadow root (scroll is not composed)", async () => {
    const host = holder();
    const root = host.attachShadow({ mode: 'open' });
    const scroller = document.createElement('div');
    scroller.style.cssText = 'position: relative; height: 120px; overflow: auto;';
    const tall = document.createElement('div');
    tall.style.height = '600px';
    scroller.append(tall);
    root.append(scroller);
    const { target, layer } = fixture(tall, 10, 60);
    cleanup.push(() => layer.remove());
    const placed = anchor(layer, target);
    placed.open();
    /**
     * Let ResizeObserver's INITIAL callback (it always sends one, a frame after `observe()`) pass first: a scroll before
     * it was repaired by that callback, and the row passed with the shadow-root listener planted out (2026-11-21).
     */
    await frames(3);
    const before = layer.getBoundingClientRect().top;
    scroller.scrollTop = 40;
    await frames(3);
    const after = layer.getBoundingClientRect().top;
    near(before - after, 40, 'moved with the scroller');
    near(after, target.getBoundingClientRect().bottom + 4, 'still attached');
    placed.close();
  });

  /**
   * **A squeezed layer's own scroll stays where the user put it.** Its `scroll` reaches the capture listener like any
   * other, and a re-placement that took the caps off to measure let the content stop overflowing, so the browser
   * clamped `scrollTop` to 0 on every frame the user scrolled it.
   */
  it("a squeezed layer's own scrolling, and a re-placement after it, keep its scroll position", async () => {
    const { target, layer } = fixture(holder(`height: ${innerHeight}px`), 40, Math.round(innerHeight / 2));
    cleanup.push(() => layer.remove());
    layer.style.cssText = 'width: 120px; overflow: auto; background: #ccc;';
    for (let i = 0; i < 200; i++) layer.append(Object.assign(document.createElement('div'), { textContent: `option ${i}` }));
    const placed = anchor(layer, target, { squeeze: true });
    placed.open();
    await frames(3);
    expect(layer.scrollHeight > layer.clientHeight + 100, 'CONTROL: the layer is squeezed, and scrolls').to.equal(true);
    const middle = Math.round((layer.scrollHeight - layer.clientHeight) / 2);
    for (let i = 0; i < 30; i++) {
      layer.scrollTop = middle + i;
      await frames(1);
    }
    await frames(2);
    near(layer.scrollTop, middle + 29, 'its own scrolling is kept');
    window.dispatchEvent(new Event('resize'));
    await frames(3);
    near(layer.scrollTop, middle + 29, 'and a re-placement keeps it too');
    const side = layer.getAttribute('data-placement');
    const [l, t] = [layer.getBoundingClientRect(), target.getBoundingClientRect()];
    if (side === 'top') near(l.bottom, t.top - 4, 'still placed at the target, above it');
    else near(l.top, t.bottom + 4, 'still placed at the target, below it');
    placed.close();
  });

  /**
   * **A top-layer popover in a right-to-left document sits at its target.** The UA gives `[popover]` `inset: 0`, so with
   * only `left` and `top` written its `right: 0` stays; with a fixed width the box is over-constrained, and in
   * right-to-left `left` is the one dropped, so the layer sat against the right edge. A plain div has no UA inset, which
   * is why the rows above never saw it.
   */
  it('a shown popover in a right-to-left document is placed at its target', () => {
    document.documentElement.setAttribute('dir', 'rtl');
    cleanup.push(() => document.documentElement.removeAttribute('dir'));
    const { target, layer } = fixture(holder('height: 200px'), 40, 20);
    layer.setAttribute('popover', 'manual');
    layer.showPopover();
    cleanup.push(() => {
      if (layer.matches(':popover-open')) layer.hidePopover();
      layer.remove();
    });
    const placed = anchor(layer, target);
    placed.open();
    const t = target.getBoundingClientRect();
    const l = layer.getBoundingClientRect();
    near(l.top, t.bottom + 4, 'top');
    near(l.right, t.right, 'right edges aligned: start is the right edge in right-to-left');
    placed.close();
  });

  it('close() puts back exactly the inline style it found, and stops placing', async () => {
    const { target, layer } = fixture(holder('height: 200px'), 40, 20);
    cleanup.push(() => layer.remove());
    layer.style.setProperty('margin', '3px', 'important');
    const before = layer.getAttribute('style');
    const placed = anchor(layer, target);
    placed.open();
    placed.close();
    expect(layer.getAttribute('style')).to.equal(before);
    expect(layer.hasAttribute('data-placement')).to.equal(false);
    window.dispatchEvent(new Event('resize'));
    await frames(2);
    expect(layer.getAttribute('style')).to.equal(before);
  });
});
