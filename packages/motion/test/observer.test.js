import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMutationObserver, observerOptions } from '../src/modules/observer.ts';

let instances;
class FakeMO {
  constructor(cb) { this.cb = cb; instances.push(this); }
  observe() {} disconnect() { this.disconnected = true; }
  fire(records) { this.cb(records); }
}
const el = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.firstElementChild; };

beforeEach(() => { instances = []; vi.stubGlobal('MutationObserver', FakeMO); });

const make = () => {
  const onChanged = vi.fn(), onRemoved = vi.fn();
  createMutationObserver({ onChanged, onRemoved });
  return { mo: instances[0], onChanged, onRemoved };
};

describe('observerOptions', () => {
  it('watches children as well as attributes', () => {
    /** Only attributes were watched before; added elements never animated. */
    expect(observerOptions()).toMatchObject({ childList: true, subtree: true, attributes: true });
  });
});

describe('createMutationObserver', () => {
  it('reports an animated element that was added', () => {
    const { mo, onChanged } = make();
    const added = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([{ type: 'childList', addedNodes: [added], removedNodes: [] }]);
    expect(onChanged).toHaveBeenCalledWith([added]);
  });

  it('finds animated elements nested inside an added subtree', () => {
    const { mo, onChanged } = make();
    const wrapper = el('<section><p data-vm data-vm-opacity="0"></p></section>');
    mo.fire([{ type: 'childList', addedNodes: [wrapper], removedNodes: [] }]);
    expect(onChanged.mock.calls[0][0]).toHaveLength(1);
  });

  it('ignores added elements that are not animated', () => {
    const { mo, onChanged } = make();
    mo.fire([{ type: 'childList', addedNodes: [el('<div></div>')], removedNodes: [] }]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('reports removals', () => {
    const { mo, onRemoved } = make();
    const gone = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([{ type: 'childList', addedNodes: [], removedNodes: [gone] }]);
    expect(onRemoved).toHaveBeenCalledWith([gone]);
  });

  it('reports an attribute change on an animated element', () => {
    const { mo, onChanged } = make();
    const node = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([{ type: 'attributes', attributeName: 'data-vm-opacity', target: node, addedNodes: [], removedNodes: [] }]);
    expect(onChanged).toHaveBeenCalledWith([node]);
  });

  /** The runtime writes style every frame; watching it would feed on its own output. */
  it('ignores style changes, which are its own writes', () => {
    const { mo, onChanged } = make();
    const node = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([{ type: 'attributes', attributeName: 'style', target: node, addedNodes: [], removedNodes: [] }]);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('treats an element added and removed in one batch as removed', () => {
    const { mo, onChanged, onRemoved } = make();
    const node = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([{ type: 'childList', addedNodes: [node], removedNodes: [node] }]);
    expect(onChanged).not.toHaveBeenCalled();
    expect(onRemoved).toHaveBeenCalledWith([node]);
  });

  it('deduplicates an element touched several times in one batch', () => {
    const { mo, onChanged } = make();
    const node = el('<div data-vm data-vm-opacity="0"></div>');
    mo.fire([
      { type: 'attributes', attributeName: 'data-vm-opacity', target: node, addedNodes: [], removedNodes: [] },
      { type: 'attributes', attributeName: 'data-vm-scale', target: node, addedNodes: [], removedNodes: [] },
    ]);
    expect(onChanged.mock.calls[0][0]).toHaveLength(1);
  });

  it('ignores text nodes without throwing', () => {
    const { mo, onChanged } = make();
    expect(() => mo.fire([{ type: 'childList', addedNodes: [document.createTextNode('x')], removedNodes: [] }])).not.toThrow();
    expect(onChanged).not.toHaveBeenCalled();
  });
});


describe('a move is not a removal', () => {
  /**
   * A re-parent arrives as a removal and an addition in the same batch. The
   * observer used to resolve that by dropping the element, so anything
   * dragged, sorted or reconciled into a new parent silently stopped
   * animating — which a block editor does constantly.
   */
  it('reports a re-parented element as changed, not removed', () => {
    const { mo, onChanged, onRemoved } = make();
    document.body.innerHTML = '<div id="to"></div>';
    const node = el('<div data-vm></div>');
    document.getElementById('to').appendChild(node);

    mo.fire([
      { type: 'childList', addedNodes: [node], removedNodes: [] },
      { type: 'childList', addedNodes: [], removedNodes: [node] },
    ]);

    expect(onChanged).toHaveBeenCalledWith([node]);
    expect(onRemoved).not.toHaveBeenCalled();
  });

  it('still reports a genuinely detached element as removed', () => {
    const { mo, onChanged, onRemoved } = make();
    const node = el('<div data-vm></div>');

    mo.fire([
      { type: 'childList', addedNodes: [node], removedNodes: [] },
      { type: 'childList', addedNodes: [], removedNodes: [node] },
    ]);

    expect(onRemoved).toHaveBeenCalledWith([node]);
    expect(onChanged).not.toHaveBeenCalled();
  });
});
