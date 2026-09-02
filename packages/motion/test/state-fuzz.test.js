import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';

wireMotion([split]);

const settle = () => new Promise((r) => setTimeout(r, 0));
const place = (n, top) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 120, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

/** Deterministic PRNG, so a failure is reproducible from the seed. */
let seed = 20260826;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const pick = (list) => list[Math.floor(rnd() * list.length)];

describe('interleaved operations', () => {
  it('survives 400 random operations without throwing or corrupting state', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    const errors = [];
    let counter = 0;

    const OPS = [
      ['init', () => m.init()],
      ['destroy', () => m.destroy()],
      ['enable', () => m.enable()],
      ['disable', () => m.disable()],
      ['refresh', () => m.refresh()],
      ['observe', () => m.observe(host)],
      ['unobserve', () => m.unobserve(host)],
      ['add plain', () => {
        const n = document.createElement('div');
        n.id = `n${counter++}`;
        n.setAttribute('data-vm', '');
        n.setAttribute('data-vm-translate-y', '0% 0px, 100% 40px');
        host.append(n); place(n, 300 + counter * 10);
      }],
      ['add split', () => {
        const n = document.createElement('p');
        n.id = `n${counter++}`;
        n.setAttribute('data-vm', '');
        n.setAttribute('data-vm-split', 'words');
        n.setAttribute('data-vm-opacity', '0% 0, 100% 1');
        n.textContent = 'alpha beta gamma';
        host.append(n); place(n, 300 + counter * 10);
      }],
      ['remove one', () => { host.firstElementChild?.remove(); }],
      ['scroll', () => {
        Object.defineProperty(window, 'scrollY', { value: Math.floor(rnd() * 2000), configurable: true });
        window.dispatchEvent(new Event('scroll'));
      }],
      ['toggle class', () => { host.firstElementChild?.classList.toggle('on'); }],
      ['edit value', () => {
        const n = host.firstElementChild;
        if (n && n.hasAttribute('data-vm-translate-y')) {
          n.setAttribute('data-vm-translate-y', `0% 0px, 100% ${Math.floor(rnd() * 200)}px`);
        }
      }],
    ];

    const log = [];
    for (let i = 0; i < 400; i++) {
      const [name, run] = pick(OPS);
      log.push(name);
      try { run(); } catch (error) { errors.push(`${i} ${name}: ${error.message}`); }
      if (i % 3 === 0) await settle();
    }
    /**
     * Finish in a known-good state before asserting. Left as the fuzz happened
     * to end, the instance was usually destroyed — `registered: 0` made every
     * consistency check below pass without testing anything.
     */
    m.destroy();
    m.init();
    m.observe(host);
    m.enable();
    await settle(); await settle(); await settle();

    /** State must be internally consistent whatever the order was. */
    const registered = m.elements.length;
    const duplicates = registered - new Set(m.elements.map((e) => e.node)).size;
    /**
     * A split container keeps the marker but is deliberately never registered
     * itself — its pieces are. Counting it as unregistered is the probe being
     * wrong, not the runtime.
     */
    const unregistered = [...host.querySelectorAll('[data-vm]')]
      .filter((n) => !n.hasAttribute('data-vm-split'))
      .filter((n) => !m.elements.some((e) => e.node === n));
    expect(errors).toEqual([]);
    expect(duplicates).toBe(0);
    /** Nothing registered may be detached. */
    expect(m.elements.filter((e) => !e.node.isConnected)).toHaveLength(0);
    /** Every marked element in the tree must be animated once it is re-initialised. */
    expect(unregistered).toHaveLength(0);
    expect(registered).toBeGreaterThan(0);
    m.destroy();
  });
});
