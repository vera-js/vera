import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseElement } from '../src/modules/parse.ts';

const P = 'data-vm';
const ctx = { origin: 'https://x.test/', breakpoints: new Map([['mobile', { min: 0, max: 700 }]]) };

const opacityOf = (id) => {
  const parsed = parseElement(document.getElementById(id), ctx);
  return parsed?.animations.find((a) => a.property.attribute === 'opacity') ?? null;
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * A preset supplies base keyframes. A band says at which widths the animation
 * differs — it does not say the preset was a mistake.
 */
describe('a preset alongside a band-suffixed override', () => {
  it('keeps the preset as the base', () => {
    document.body.innerHTML =
      `<div id="a" ${P}="fade" ${P}-opacity-mobile="0% 0.5, 100% 1"></div>`;
    const opacity = opacityOf('a');
    /** The preset's own curve, at every width outside the band. */
    expect(opacity.keyframes.map((k) => k.value)).toEqual([0, 1]);
    expect(opacity.bands).toHaveLength(1);
    expect(opacity.bands[0].keyframes.map((k) => k.value)).toEqual([0.5, 1]);
  });

  it('brings the preset’s other properties with it', () => {
    document.body.innerHTML =
      `<div id="a" ${P}="fade-up" ${P}-opacity-mobile="0% 0.5, 100% 1"></div>`;
    const parsed = parseElement(document.getElementById('a'), ctx);
    const moved = parsed.animations.find((x) => x.property.attribute === 'translate-y');
    expect(moved.keyframes.map((k) => k.value)).toEqual([40, 0]);
  });

  it('still lets an explicit base replace the preset outright', () => {
    document.body.innerHTML =
      `<div id="a" ${P}="fade" ${P}-opacity="0% 0.2, 100% 1"></div>`;
    expect(opacityOf('a').keyframes.map((k) => k.value)).toEqual([0.2, 1]);
  });

  it('an explicit base wins even when a band suffix is there too', () => {
    document.body.innerHTML =
      `<div id="a" ${P}="fade" ${P}-opacity="0% 0.2, 100% 1"
        ${P}-opacity-mobile="0% 0.5, 100% 1"></div>`;
    const opacity = opacityOf('a');
    expect(opacity.keyframes.map((k) => k.value)).toEqual([0.2, 1]);
    expect(opacity.bands).toHaveLength(1);
  });

  it('an inline band is an explicit attribute and still wins outright', () => {
    document.body.innerHTML =
      `<div id="a" ${P}="fade" ${P}-opacity="[0-700]: 0% 0.5, 100% 1"></div>`;
    const opacity = opacityOf('a');
    expect(opacity.keyframes).toEqual([]);
    expect(opacity.bands).toHaveLength(1);
  });

  it('leaves a plain preset alone', () => {
    document.body.innerHTML = `<div id="a" ${P}="fade"></div>`;
    expect(opacityOf('a').keyframes.map((k) => k.value)).toEqual([0, 1]);
  });
});
