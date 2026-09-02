/**
 * Runs the **built production artifact** against the published contract.
 *
 * Every other file in this suite runs `src`, where every property name
 * survives — so nothing else here can notice a public name landing on the
 * `INTERNAL_PROPS` mangle list in rollup.config.js and shipping renamed. This
 * file is that check: it imports `dist/vera-motion.min.js` and reads exactly
 * what the README and the types promise — `instance.elements[i].node`,
 * `instance.elements[i].timelinePosition`, the `rejected` shape, and an
 * animation actually landing in style.
 *
 * The control matters (the probe rule): the transform assertion is what makes
 * a silent import failure or an inert instance fail rather than pass — a run
 * that animated nothing would report a perfect surface.
 *
 * Skips **visibly** when `dist` has not been built (`npm test` straight after
 * a clone). The check pipeline and the root gate always build first.
 */
import { existsSync } from 'node:fs';
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';

const DIST = new URL('../dist/vera-motion.min.js', import.meta.url);
const built = existsSync(DIST);

const place = (node) => {
  Object.defineProperty(node, 'offsetTop', { value: 500, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
};

describe('the built production artifact honours the published contract', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('animates, reports, and exposes exactly the public element shape', async (t) => {
    if (!built) return t.skip('dist/vera-motion.min.js not built — run npm run build first');

    const { createMotion } = await import(DIST.href);

    const node = document.createElement('div');
    node.setAttribute('data-vera-motion', '');
    node.setAttribute('data-vera-motion-translate-y', '0% 0, 100% 40px');
    /** An unknown attribute, so `rejected` has something to answer with. */
    node.setAttribute('data-vera-motion-bogus', '1');
    place(node);
    document.body.appendChild(node);

    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    /** The control: the artifact really animated something. */
    expect(m.elements).toHaveLength(1);
    expect(node.style.transform).toMatch(/translateY\(/);

    /** The published element shape, by the names the types promise. */
    const element = m.elements[0];
    expect(element.node).toBe(node);
    expect(typeof element.timelinePosition).toBe('number');

    /** The `rejected` shape: `{ node, rejected }`, reasons present. */
    const entry = m.rejected.find((r) => r.node === node);
    expect(entry).toBeTruthy();
    expect(entry.rejected.length).toBeGreaterThan(0);
    expect(entry.rejected[0]).toContain('data-vera-motion-bogus');

    m.destroy();
    expect(node.style.transform).toBe('');
  });
});
