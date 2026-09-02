import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

const withShadow = (mode = 'open') => {
  document.body.innerHTML = '<div id="host"></div>';
  const host = document.getElementById('host');
  const root = host.attachShadow({ mode });
  root.innerHTML = '<div id="inner" data-vera-motion data-vera-motion-translate-y="0% 0px, 100% 40px"></div>';
  place(root.getElementById('inner'));
  return { host, root, inner: root.getElementById('inner') };
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('shadow DOM roots', () => {
  it('does not reach into a shadow root without being told', () => {
    withShadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(m.elements).toHaveLength(0);
    m.destroy();
  });

  it('animates once the root is observed', async () => {
    const { root, inner } = withShadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();
    expect(m.elements).toHaveLength(1);
    expect(inner.style.transform).not.toBe('');
    m.destroy();
  });

  it('picks up an element added inside an observed shadow root', async () => {
    const { root } = withShadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);

    const late = document.createElement('div');
    late.setAttribute('data-vera-motion', '');
    late.setAttribute('data-vera-motion-opacity', '0% 0, 100% 1');
    root.append(late);
    place(late, 600);
    await settle();
    expect(m.elements).toHaveLength(2);
    m.destroy();
  });

  it('restores shadow elements on destroy', async () => {
    const { root, inner } = withShadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    await settle();
    expect(inner.style.transform).not.toBe('');
    m.destroy();
    expect(inner.style.transform).toBe('');
  });

  it('unobserve() stops and cleans that root', () => {
    const { root, inner } = withShadow();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.observe(root);
    m.unobserve(root);
    expect(m.elements).toHaveLength(0);
    expect(inner.style.transform).toBe('');
    m.destroy();
  });

});
