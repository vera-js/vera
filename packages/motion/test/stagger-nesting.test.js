import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { parseElement } from '../src/modules/parse.ts';

const ctx = { origin: 'https://x.test/' };
const P = 'data-vm';
const FADE = `${P} ${P}-opacity="0% 0, 100% 1"`;
const at = (id) => parseElement(document.getElementById(id), ctx)?.stagger ?? null;

beforeEach(() => { document.body.innerHTML = ''; });

/**
 * A stagger offset is index x step, and the index is document order among the
 * descendants the host staggers. "Descendants the host staggers" is doing the
 * work: a nested group resolves against its own nearest host, so counting its
 * members here uses each of them twice.
 */
describe('nested stagger groups', () => {
  it('does not let an inner group shift the outer group’s later members', () => {
    document.body.innerHTML = `
      <div ${P}-stagger="10%">
        <div ${FADE} id="A"></div>
        <p ${FADE} ${P}-stagger="5%" id="B">
          <span ${FADE} id="B1"></span>
          <span ${FADE} id="B2"></span>
          <span ${FADE} id="B3"></span>
        </p>
        <div ${FADE} id="C"></div>
      </div>`;

    /** First member of its group: no offset, in both groups. */
    expect(at('A')).toBeNull();
    expect(at('B1')).toBeNull();

    /** The inner group runs on its own step. */
    expect(at('B2')).toEqual({ position: 5, positionUnit: '%' });
    expect(at('B3')).toEqual({ position: 10, positionUnit: '%' });

    /** B is the outer group's second member, C its third. */
    expect(at('B')).toEqual({ position: 10, positionUnit: '%' });
    expect(at('C')).toEqual({ position: 20, positionUnit: '%' });
  });

  it('leaves an element after the inner group where it is when the inner grows', () => {
    const build = (pieces) => {
      document.body.innerHTML = `
        <div ${P}-stagger="10%">
          <p ${FADE} ${P}-stagger="5%" id="B">
            ${Array.from({ length: pieces }, (_, i) => `<span ${FADE} id="p${i}"></span>`).join('')}
          </p>
          <div ${FADE} id="C"></div>
        </div>`;
      return at('C');
    };

    /**
     * The whole point. `split` keeps `stagger` on the container and marks every
     * piece, so this is what editing the text of a staggered paragraph did to
     * the element below it.
     */
    expect(build(2)).toEqual(build(40));
    expect(build(2)).toEqual({ position: 10, positionUnit: '%' });
  });

  it('still counts a plain group by document order', () => {
    document.body.innerHTML = `
      <div ${P}-stagger="10%">
        <div ${FADE} id="A"></div>
        <div ${FADE} id="B"></div>
        <div ${FADE} id="C"></div>
      </div>`;
    expect(at('A')).toBeNull();
    expect(at('B')).toEqual({ position: 10, positionUnit: '%' });
    expect(at('C')).toEqual({ position: 20, positionUnit: '%' });
  });

  it('counts a nested group’s own members from its own host, whatever the depth', () => {
    document.body.innerHTML = `
      <div ${P}-stagger="10%">
        <div ${FADE} id="A"></div>
        <section ${P}-stagger="3%">
          <div><div ${FADE} id="N1"></div></div>
          <div><div ${FADE} id="N2"></div></div>
        </section>
      </div>`;
    expect(at('N1')).toBeNull();
    expect(at('N2')).toEqual({ position: 3, positionUnit: '%' });
  });
});
