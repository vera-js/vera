import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { easings } from '../src/easings.ts';
import { properties, settings as allSettings } from '../src/modules/schema.ts';
wireMotion([easings]);
const P = 'data-vera-motion';
beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.stubGlobal('requestAnimationFrame', (fn) => { fn(0); return 1; }); vi.stubGlobal('cancelAnimationFrame', () => {}); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const JUNK = ['', ' ', 'NaN', 'null', '-1', '1e999', '0/0', '[', '[]:', '%', 'px', '0% ', ' 0% 1',
  '0%,100%', '0% 1e999', 'Infinity', '1,2,3', ';;;', '0% 1;;', 'e', '[-1-2]: 0% 1', '0% NaN',
  '0px 1', '{}', '0% 1 2', 'zzz', '0% 1, 100%', '0% 1, zz 2'];
const ALPHA = '0123456789.,;:%[]+-()pxremvhdegabc \t';
let seed = 987654321;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = 0; i < 300; i++) {
  JUNK.push(Array.from({ length: 1 + Math.floor(rnd() * 24) }, () => ALPHA[Math.floor(rnd() * ALPHA.length)]).join(''));
}

/**
 * The invariant behind a dozen audit passes, mechanised.
 *
 * Every one of those passes found the same shape: an attribute that parses,
 * validates, saves, and then does nothing, with `rejected` empty. The README
 * sends anyone whose element is not animating to that list and says it holds
 * every refusal, and the GUI this library exists for renders it and cannot
 * read a console. So the rule is: **if an attribute produced no animation and
 * no setting, something must say so.**
 *
 * Found `translate-y=","` — a value made of nothing but a separator, on every
 * property. The empty-segment skip is right for a trailing or doubled comma
 * among real keyframes; a value that is *only* separators is the empty-value
 * mistake wearing one.
 *
 * The corpus is deliberately hostile and partly random, and the random half is
 * what found it: hand-written junk tends to be junk someone already thought of.
 *
 * `paint` is excluded. Its validator is `CSS.supports`, and happy-dom returns
 * `true` for everything — so every value would appear to take here, which is
 * an answer about the environment rather than the library. `spikes/paint.mjs`
 * asks a real engine.
 */
describe('nothing refuses in silence', () => {
  /**
   * **An explicit budget, because this sweep is large by design.** Every
   * property and every setting against 328 junk values is ~6,500 instances,
   * about 3s on a quiet machine — comfortably inside the 5s default, and not
   * inside it when anything else is using the cores. It tripped on 2026-08-31
   * with a mutation run going, which is the same "quiet machine" rule the
   * harnesses have and the same failure: a fixed limit against a variable
   * machine. Shrinking the sweep would be trading coverage for a number.
   */
  it('a property attribute that produces nothing must say why', { timeout: 30000 }, () => {
    const silent = [];
    for (const prop of properties()) {
      if (prop.category === 'paint') continue;
      for (const value of JUNK) {
        document.body.innerHTML = `<div id="a" ${P} ${P}-${prop.attribute}="${value}"></div>`;
        const m = createMotion({ respectReducedMotion: false, inertia: 0 });
        m.init();
        const el = m.elements[0];
        const built = el?.parsed.animations.some((a) => a.property.attribute === prop.attribute);
        const said = [...(el?.parsed.rejected ?? []), ...m.rejected.flatMap((r) => r.rejected)];
        if (!built && said.length === 0) silent.push(`${prop.attribute}="${value}"`);
        m.destroy();
      }
    }
    expect(silent.slice(0, 10)).toEqual([]);
  });

  it('a setting attribute that does not take must say why', { timeout: 30000 }, () => {
    const silent = [];
    for (const setting of allSettings()) {
      for (const value of JUNK) {
        document.body.innerHTML =
          `<div id="a" ${P} ${P}-opacity="0% 0, 100% 1" ${P}-${setting.attribute}="${value}"></div>`;
        const m = createMotion({ respectReducedMotion: false, inertia: 0 });
        m.init();
        const el = m.elements[0];
        const took = el && setting.attribute in el.parsed.settings;
        const said = [...(el?.parsed.rejected ?? []), ...m.rejected.flatMap((r) => r.rejected)];
        if (!took && said.length === 0) silent.push(`${setting.attribute}="${value}"`);
        m.destroy();
      }
    }
    expect(silent.slice(0, 10)).toEqual([]);
  });
});
