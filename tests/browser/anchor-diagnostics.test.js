/**
 * **`@vera-hooks/anchor`'s development warnings in real engines**: each is printed for the case it names, by its code,
 * and not for the case beside it that is fine. jsdom has no layout, so these are browser rows.
 */
import { expect } from '@esm-bundle/chai';
import { anchor } from '../../packages/hooks/anchor/dist/development/vera-anchor.js';
import { frames } from './until.js';

let cleanup = [];
let warned = [];
const realWarn = console.warn;
beforeEach(() => {
  warned = [];
  console.warn = (...args) => warned.push(args.map(String).join(' '));
});
afterEach(() => {
  console.warn = realWarn;
  for (const undo of cleanup.splice(0)) undo();
});
/** Opens `placed` and closes it at the row's end, so no listener of one row hears the next row's events. */
const opened = (placed) => {
  placed.open();
  cleanup.unshift(() => placed.close());
  return placed;
};
const codes = () => warned.map((line) => (line.match(/\((anchor-[a-z-]+)\)$/) ?? [])[1] ?? line);

/** A 100x30 target in a holder styled `css`, and a 120x80 layer in `layerParent` (the body unless given). */
const fixture = (css = '', layerParent = null) => {
  const holder = document.createElement('div');
  holder.style.cssText = `position: relative; height: 200px; ${css}`;
  document.body.prepend(holder);
  const target = document.createElement('button');
  target.style.cssText = 'position: absolute; left: 40px; top: 20px; width: 100px; height: 30px;';
  holder.append(target);
  const layer = document.createElement('div');
  layer.style.cssText = 'width: 120px; height: 80px; background: #ccc;';
  (layerParent === 'holder' ? holder : document.body).append(layer);
  cleanup.push(() => {
    holder.remove();
    layer.remove();
  });
  return { holder, target, layer };
};

describe('anchor, development warnings', () => {
  it('CONTROL: a plain layer on a plain target warns nothing', async () => {
    const { target, layer } = fixture();
    const placed = anchor(layer, target);
    placed.open();
    await frames(2);
    placed.close();
    expect(warned, 'nothing to warn about').to.deep.equal([]);
  });

  it('open() on a layer that is not shown warns anchor-layer-hidden', () => {
    const { target, layer } = fixture();
    layer.style.display = 'none';
    const placed = anchor(layer, target);
    placed.open();
    placed.close();
    expect(codes()).to.deep.equal(['anchor-layer-hidden']);
    expect(warned[0].startsWith('[vera] anchor: <div> — '), warned[0]).to.equal(true);
  });

  it('a target removed while open closes the layer and warns anchor-target-removed', async () => {
    const { target, layer } = fixture();
    const placed = anchor(layer, target);
    placed.open();
    expect(layer.hasAttribute('data-placement'), 'CONTROL: open').to.equal(true);
    target.remove();
    window.dispatchEvent(new Event('resize'));
    await frames(3);
    expect(codes()).to.deep.equal(['anchor-target-removed']);
    expect(layer.hasAttribute('data-placement'), 'and it closed').to.equal(false);
  });

  it('a rotated containing block warns anchor-rotated; a translated and scaled one does not', () => {
    const turned = fixture('transform: rotate(10deg)', 'holder');
    opened(anchor(turned.layer, turned.target));
    expect(codes()).to.deep.equal(['anchor-rotated']);
    warned = [];
    const moved = fixture('transform: translate(37px, 11px) scale(0.5); transform-origin: 0 0', 'holder');
    opened(anchor(moved.layer, moved.target));
    expect(codes(), 'translation and scale are corrected for, so nothing to say').to.deep.equal([]);
  });

  it('a containing block that clips warns anchor-clipped naming it; a clipping element below the block does not', () => {
    const clipped = fixture('transform: translate(0, 0); overflow: hidden', 'holder');
    opened(anchor(clipped.layer, clipped.target));
    expect(codes()).to.deep.equal(['anchor-clipped']);
    expect(warned[0].includes('<div>'), warned[0]).to.equal(true);
    warned = [];
    /** The clip is BETWEEN the layer and its containing block (the viewport): it does not clip a fixed descendant. */
    const between = fixture('overflow: hidden', 'holder');
    opened(anchor(between.layer, between.target));
    expect(codes(), 'an overflow below the containing block clips nothing of the layer').to.deep.equal([]);
  });
});
