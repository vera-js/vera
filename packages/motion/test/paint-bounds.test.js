/**
 * The two bounds on the paint slot table.
 *
 * **Its own file on purpose.** The table is module-global and a slot can never
 * be reclaimed — that is the design, since the number is baked into a curve the
 * runtime has already built. So the test that fills it poisons every later
 * paint test sharing the module instance, and it is placed last here for the
 * same reason. Vitest isolates per file, which is what makes this containable
 * at all.
 *
 * The bounds exist because the table's input is every distinct value ever
 * *parsed*, not every value on the page: a GUI rewriting the attribute on each
 * drag of a colour picker mints a slot per intermediate colour, forever. That
 * is a GUI editor's exact usage, which is why an unbounded table was the hazard
 * worth capping.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';

wireMotion(paint);

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  Object.defineProperty(document.documentElement, 'scrollHeight', { value: 6000, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 800, configurable: true });
});
afterEach(() => vi.restoreAllMocks());

const start = (html) => {
  document.body.innerHTML = html;
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  return m;
};
const reasons = (m) => m.rejected.map((r) => r.rejected).flat();

describe('a value longer than the length cap', () => {
  it('is refused, so one attribute cannot fill the table by itself', () => {
    const long = `rgb(${'0'.repeat(400)},0,0)`;
    const m = start(`<div data-vm data-vm-background="0% red, 100% ${long}"></div>`);
    expect(reasons(m).some((r) => r.includes('background'))).toBe(true);
    m.destroy();
  });

  it('and the keyframe that was fine still is', () => {
    const long = `rgb(${'0'.repeat(400)},0,0)`;
    const m = start(`<div data-vm data-vm-background="0% red, 100% ${long}"></div>`);
    expect(reasons(m)).toHaveLength(1);
    m.destroy();
  });
});

/** Last, because it fills the table for the rest of this file's module instance. */
describe('more distinct values than the table holds', () => {
  const flood = () => {
    const many = [];
    for (let i = 0; i < 1200; i++) {
      many.push(
        `<div data-vm data-vm-background="0% rgb(${i % 256}, ${(i >> 8) % 256}, ${i % 7}), 100% rgb(1,2,${i % 251})"></div>`
      );
    }
    return start(many.join(''));
  };

  /**
   * Through `pageProblem`, which warns *and* records. It was a bare
   * `console.warn`, so the one sentence explaining the cap reached only the
   * console — and the GUI this cap exists for renders `instance.rejected` and
   * cannot read one. The warning is still asserted here because a page author
   * watching devtools is the other reader.
   */
  it('says so exactly once, however many are refused', () => {
    const m = flood();
    const said = warnings.filter((w) => w.includes('distinct paint values'));
    expect(said).toHaveLength(1);
    expect(said[0]).toContain('cannot be reclaimed');
    expect(reasons(m).filter((r) => r.includes('distinct paint values'))).toHaveLength(1);
    m.destroy();
  });

  it('and reports every value it could not seat', () => {
    const m = flood();
    expect(m.rejected.length).toBeGreaterThan(0);
    m.destroy();
  });

  /**
   * The half that matters for a page already running: a colour that got a slot
   * before the cap goes on working, so filling the table degrades what comes
   * next rather than breaking what is already there.
   */
  it('leaves values that already hold a slot working', () => {
    /**
     * The flooding instance stays **alive** here, which is the whole setup.
     *
     * It used to be `flood().destroy()`, on the reasoning that "a full table
     * is a fact about the page and stays true, so every later instance reports
     * it". That premise stopped being true when `forget` landed: destroying
     * the last live instance now empties the table, so the old setup left an
     * *empty* one and quietly stopped testing the cap at all. Keeping the
     * flooder alive keeps the table full, which is the condition this test is
     * about — and the two-instance shape also proves `forget` does not fire
     * while something is still animating.
     */
    const flooder = flood();
    const m = start('<div data-vm data-vm-background="0% rgb(0, 0, 0), 100% rgb(1,2,3)"></div>');
    /**
     * **The element**, not the page. While the table is full that is a fact
     * about the page, so every live instance reports it — which is what
     * `pageProblem` is for. What must be empty is the element's own list: the
     * colours it uses were seated before the cap and still work.
     */
    const perElement = m.rejected.filter((entry) => entry.node);
    expect(perElement.map((entry) => entry.rejected).flat()).toEqual([]);
    expect(reasons(m)).toEqual([expect.stringContaining('distinct paint values')]);
    m.destroy();
    flooder.destroy();
  });

  /**
   * And the recovery the `forget` insert exists for: once **no** instance is
   * animating the page, the table is emptied and the cap's page problem is
   * retracted with it. Before that this was a page-lifetime condition — an
   * editor that exhausted the table stayed exhausted until a reload.
   */
  it('is emptied once no instance is left animating the page', () => {
    flood().destroy();
    const m = start('<div data-vm data-vm-background="0% rgb(9, 9, 9), 100% rgb(8,8,8)"></div>');
    expect(reasons(m)).toEqual([]);
    m.destroy();
  });
});
