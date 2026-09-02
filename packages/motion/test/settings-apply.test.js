import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { path } from '../src/path.ts';

wireMotion(path);
import { parseOrigin } from '../src/modules/schema.ts';

/**
 * Every setting must reach the DOM, not merely parse. Two settings have
 * shipped in this repo that validated cleanly and were then read by nobody
 * (transform-inertia and filter-inertia), so a parse test is not evidence.
 */
const run = (html) => {
  document.body.innerHTML = html;
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  return { node: document.body.firstElementChild, m };
};

describe('every setting reaches the DOM', () => {
  it('will-change', () => {
    const { node, m } = run('<div data-vm data-vm-will-change data-vm-opacity="0% 0, 100% 1"></div>');
    /** `opacity` is a filter function here, so `filter` is the whole hint. */
    expect(node.style.willChange).toBe('filter');
    m.destroy();
  });

  it('will-change explicitly false overrides an instance default', () => {
    document.body.innerHTML = '<div data-vm data-vm-will-change="false" data-vm-opacity="0% 0, 100% 1"></div>';
    const m = createMotion({ respectReducedMotion: false, willChange: true });
    m.init();
    const node = document.body.firstElementChild;
    expect(node.style.willChange).toBe('');
    m.destroy();
  });

  it('transform-origin', () => {
    const { node, m } = run('<div data-vm data-vm-transform-origin="top left" data-vm-scale="0% 1, 100% 2"></div>');
    expect(node.style.transformOrigin).toBe('top left');
    m.destroy();
  });

  it('pin', () => {
    const { node, m } = run('<div data-vm data-vm-pin="120px" data-vm-opacity="0% 0, 100% 1"></div>');
    expect(node.style.position).toBe('sticky');
    expect(node.style.top).toBe('120px');
    m.destroy();
  });

  it('path-selector and path-rotate', () => {
    document.body.innerHTML =
      '<svg><path id="p" d="M0,0 L100,100"></path></svg>' +
      '<div id="t" data-vm data-vm-path-selector="#p" ' +
      'data-vm-path-rotate="auto" data-vm-path="0% 0, 100% 100"></div>';
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    const node = document.getElementById('t');
    expect(node.style.offsetPath).toContain('M0,0 L100,100');
    expect(node.style.offsetRotate).toBe('auto');
    m.destroy();
  });

  it('perspective', () => {
    const { node, m } = run('<div data-vm data-vm-perspective="800" data-vm-translate-z="0% 0px, 100% 50px"></div>');
    expect(node.style.transform).toContain('perspective(800px)');
    m.destroy();
  });
});

/**
 * The `transform-origin` grammar, which "one to three keywords or lengths" is
 * not.
 *
 * CSS has two two-value forms — `[left|center|right|<len>]
 * [top|center|bottom|<len>]`, or two keywords in *either* order with one per
 * axis — and a third value that must be a length. Every component being
 * individually legal is not the grammar, and seven forms were accepted here
 * that every engine refuses, which means a `transform-origin` declaration
 * dropped whole and the origin silently not applied.
 *
 * That is precisely what `parseOrigin` exists to stop: its own docblock says
 * the browser's setter refuses anything malformed anyway, and this validates so
 * the value does not reach `parsed.settings` looking accepted.
 *
 * The expectations were read off `CSS.supports` in Chromium, Firefox and
 * WebKit rather than off the specification — `10px top` is legal and
 * `top 10px` is not, which is the kind of asymmetry a summary loses.
 * `spikes/origin-validity.mjs` keeps them honest.
 */
describe('transform-origin follows the real grammar', () => {
  it.each([
    'center', '10px', 'top left', 'left top', 'center top', 'top center',
    '10px top', 'left 10px', '10px 20px', 'center 10px', '10px center',
    'left top 10px', 'top left 10px', 'center center 10px', '10px 20px 30px',
    'left 10px 20px', '50% 50%', '-10% 200%', 'left bottom', 'bottom right',
  ])('accepts %s, as every engine does', (value) => {
    expect(parseOrigin(value)).toBe(value);
  });

  it.each([
    'top bottom', 'left right', 'top top', 'top 10px', '10px left',
    'left top top', 'center center center',
  ])('refuses %s, as every engine does', (value) => {
    expect(parseOrigin(value)).toBeNull();
  });
});
