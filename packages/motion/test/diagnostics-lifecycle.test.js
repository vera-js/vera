import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const P = 'data-vm';
const settle = async () => {
  await new Promise((r) => setTimeout(r, 25));
  await new Promise((r) => setTimeout(r, 25));
};

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * `instance.rejected` is what a GUI renders its error state from, and what the
 * README tells a developer to check when nothing animates. It is only useful
 * if it describes the element as it is *now*.
 */
describe('diagnostics describe the current markup, not its history', () => {
  it('does not accumulate an entry per edit', async () => {
    document.body.innerHTML = `<div id="t" ${P} ${P}-opacity="nonsense"></div>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    expect(m.rejected).toHaveLength(1);

    const node = document.getElementById('t');
    for (const value of ['still bad', 'also bad', 'bad again']) {
      node.setAttribute(`${P}-opacity`, value);
      await settle();
    }

    /** One element, one entry — describing the value it holds right now. */
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0].rejected).toHaveLength(1);
    expect(m.rejected[0].rejected[0]).toMatch(/^opacity: bad again \u2014 ./);
    m.destroy();
  });

  it('clears the rejection once the value is corrected', async () => {
    document.body.innerHTML = `<div id="t" ${P} ${P}-opacity="nonsense"></div>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    expect(m.rejected).toHaveLength(1);

    document.getElementById('t').setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    await settle();

    expect(m.rejected).toEqual([]);
    expect(m.elements).toHaveLength(1);
    m.destroy();
  });

  it('reports it again if the value breaks a second time', async () => {
    document.body.innerHTML = `<div id="t" ${P} ${P}-opacity="0% 0, 100% 1"></div>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();
    expect(m.rejected).toEqual([]);

    const node = document.getElementById('t');
    node.setAttribute(`${P}-opacity`, 'broken');
    await settle();
    expect(m.rejected).toHaveLength(1);

    node.setAttribute(`${P}-opacity`, '0% 0, 100% 1');
    await settle();
    expect(m.rejected).toEqual([]);
    m.destroy();
  });

  it('still reports a partly-valid element from its own parsed list', async () => {
    document.body.innerHTML =
      `<div id="t" ${P} ${P}-opacity="0% 0, 100% 1" ${P}-rotate="nonsense"></div>`;
    const m = createMotion({ respectReducedMotion: false });
    m.init();
    await settle();

    /** It parses and animates, and the bad half is still reported. */
    expect(m.elements).toHaveLength(1);
    expect(m.rejected).toHaveLength(1);
    expect(m.rejected[0].rejected).toHaveLength(1);
    expect(m.rejected[0].rejected[0]).toMatch(/^rotate: nonsense \u2014 ./);
    m.destroy();
  });
});
