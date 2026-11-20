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
