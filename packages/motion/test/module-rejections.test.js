/**
 * A module's refusals reach `MotionInstance.rejected`.
 *
 * The README tells anyone whose element is not animating to check `rejected`,
 * and says it lists **every** refused attribute. It was built from the *parse*
 * result alone, so it did not: a `<div>` carrying `frame` parses perfectly —
 * `frame` is a real property and the value is valid — and is refused only when
 * the sequence module is handed it and finds it is not a canvas. That warned to
 * the console and left `rejected` empty, for exactly the element someone is
 * staring at. The GUI this library exists for renders `rejected` and cannot
 * read a console at all.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { sequence } from '../src/sequence.ts';
import { split } from '../src/split.ts';

wireMotion([sequence, split]);

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
});
afterEach(() => vi.restoreAllMocks());

const start = () => {
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  return m;
};

const reasonsFor = (m, id) =>
  m.rejected.filter((r) => r.node.id === id).flatMap((r) => r.rejected);

describe('a sequence refusal reaches instance.rejected', () => {
  it('reports frame on an element that is not a canvas', () => {
    document.body.innerHTML =
      '<div id="a" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-url="/s/" data-vm-frame-count="10"></div>';
    const m = start();
    expect(reasonsFor(m, 'a')).toEqual([expect.stringContaining('needs a <canvas>')]);
    m.destroy();
  });

  it('reports a frame-url the origin policy refused', () => {
    document.body.innerHTML =
      '<canvas id="b" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-count="10"></canvas>';
    const m = start();
    expect(reasonsFor(m, 'b')).toEqual([expect.stringContaining('frame-url is missing or not permitted')]);
    m.destroy();
  });

  /**
   * `apply` runs every frame, so a refusal that appended per frame would turn
   * a diagnostic list into a leak. This is the assertion that would catch it.
   */
  /**
   * The module's documentation says four things it will not do, each reported
   * to the console *and* to `rejected`. Two of the four were asserted; these
   * are the other two, and both could be deleted outright with all 1,120 tests
   * still green.
   */
  it('reports a frame-count that is not a positive number', () => {
    document.body.innerHTML =
      '<canvas id="g" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-url="/s/" data-vm-frame-count="0"></canvas>';
    const m = start();
    /**
     * Two reasons, not one, and that is correct: the schema's bounds refuse it
     * at parse time and the module refuses it again when it is handed the
     * element — the same defence in depth the `frame-url` re-check exists for.
     * Asserted as containment so this does not become a test of the count.
     */
    expect(reasonsFor(m, 'g')).toEqual(
      expect.arrayContaining([expect.stringContaining('frame-count must be a positive number')])
    );
    expect(warnings.some((w) => w.includes('frame-count must be a positive number'))).toBe(true);
    m.destroy();
  });

  /**
   * The most-executed refusal in this whole suite and the one nothing checked.
   * happy-dom's canvas has no 2D context, so every well-formed sequence element
   * in every test here has taken this path since the module existed — silently,
   * which is what made it invisible.
   */
  it('reports a canvas it cannot get a 2D context from', () => {
    document.body.innerHTML =
      '<canvas id="h" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-url="/s/" data-vm-frame-count="10"></canvas>';
    const m = start();
    expect(reasonsFor(m, 'h')).toEqual([expect.stringContaining('no 2D context')]);
    expect(warnings.some((w) => w.includes('no 2D context'))).toBe(true);
    m.destroy();
  });

  it('reports it once however many frames pass', () => {
    document.body.innerHTML =
      '<div id="c" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-url="/s/" data-vm-frame-count="10"></div>';
    const m = start();
    for (let i = 0; i < 5; i++) m.refresh();
    expect(reasonsFor(m, 'c')).toHaveLength(1);
    expect(warnings.filter((w) => w.includes('needs a <canvas>'))).toHaveLength(1);
    m.destroy();
  });
});

describe('a split refusal reaches instance.rejected', () => {
  it('reports text it will not split', () => {
    document.body.innerHTML =
      '<p id="d" data-vm data-vm-split="words" ' +
      'data-vm-opacity="0% 0, 100% 1">hello <em>there</em></p>';
    const m = start();
    expect(reasonsFor(m, 'd')).toEqual([expect.stringContaining('plain text, not nested markup')]);
    m.destroy();
  });
});

/**
 * The mirror image of the cases above: not a module refusing something, but a
 * module that is not there.
 *
 * `easings` is the only one whose absence is invisible by construction. An
 * `ease` value parses, validates against the same `parseEasing` the module
 * uses, and produces an element that animates perfectly — on a straight line.
 * This file does not wire `easings`, which is what makes it the right place
 * to assert it.
 */
describe('a module that is not wired at all', () => {
  it('reports every element whose ease it could not shape', () => {
    document.body.innerHTML =
      '<div id="e1" data-vm data-vm-ease="ease-in" ' +
      'data-vm-opacity="0% 0, 100% 1"></div>' +
      '<div id="e2" data-vm data-vm-ease="ease-out" ' +
      'data-vm-opacity="0% 0, 100% 1"></div>';
    const m = start();

    /** Per element — a GUI highlights the element, not the page. */
    expect(reasonsFor(m, 'e1')).toEqual([expect.stringContaining('needs the easings module')]);
    expect(reasonsFor(m, 'e2')).toEqual([expect.stringContaining('needs the easings module')]);

    /** The console line stays once per page: five hundred elements, one line. */
    expect(warnings.filter((w) => w.includes('needs the easings module')).length).toBeLessThanOrEqual(1);
    m.destroy();
  });

  it('says nothing about a linear element, which needs no module', () => {
    document.body.innerHTML =
      '<div id="e3" data-vm data-vm-ease="linear" ' +
      'data-vm-opacity="0% 0, 100% 1"></div>';
    const m = start();
    expect(reasonsFor(m, 'e3')).toEqual([]);
    m.destroy();
  });
});

describe('the two kinds of refusal compose', () => {
  it('lists a parse-time reason and a module reason on the same element', () => {
    document.body.innerHTML =
      '<div id="e" data-vm data-vm-frame="0% 0, 100% 9" ' +
      'data-vm-frame-url="/s/" data-vm-frame-count="10" ' +
      'data-vm-grayscale="0% 0%, 100% 100%"></div>';
    const m = start();
    const reasons = reasonsFor(m, 'e');
    expect(reasons.some((r) => r.includes('grayscale'))).toBe(true);
    expect(reasons.some((r) => r.includes('needs a <canvas>'))).toBe(true);
    m.destroy();
  });

  /**
   * Pins **accumulation**, which counting cannot: one reason replacing another
   * leaves the length at one and looks identical. This element is refused by
   * two different modules for two different reasons, and must carry both.
   */
  it('keeps reasons from two different modules on one element', () => {
    document.body.innerHTML =
      '<div id="g" data-vm data-vm-split="words" ' +
      'data-vm-frame="0% 0, 100% 9" data-vm-frame-url="/s/" ' +
      'data-vm-frame-count="10">hello <em>there</em></div>';
    const m = start();
    for (let i = 0; i < 3; i++) m.refresh();
    const reasons = reasonsFor(m, 'g');
    expect(reasons.some((r) => r.includes('plain text'))).toBe(true);
    expect(reasons.some((r) => r.includes('needs a <canvas>'))).toBe(true);
    m.destroy();
  });

  it('says nothing about an element nothing refused', () => {
    document.body.innerHTML =
      '<div id="f" data-vm data-vm-opacity="0% 0, 100% 1"></div>';
    const m = start();
    expect(reasonsFor(m, 'f')).toEqual([]);
    m.destroy();
  });
});

/**
 * Where the value came from, which the message has to get right.
 *
 * `ease` reaches the runtime from the attribute *or* from the instance
 * default. The first version of this reporting named both as
 * `data-vm-ease="…"`, so a page setting `createMotion({ ease:
 * 'ease-out' })` without the module got that on every element — naming an
 * attribute not one of them carried, which sends a GUI to markup that does not
 * exist.
 */
describe('the ease reported is the ease that was written', () => {
  it('names the attribute when the element declared one', () => {
    document.body.innerHTML =
      '<div id="d1" data-vm data-vm-ease="ease-in" ' +
      'data-vm-opacity="0% 0, 100% 1"></div>';
    const m = start();
    expect(reasonsFor(m, 'd1')).toEqual([
      expect.stringContaining('data-vm-ease="ease-in"'),
    ]);
    m.destroy();
  });

  it('and says it was an option when the element declared none', () => {
    document.body.innerHTML =
      '<div id="d2" data-vm data-vm-opacity="0% 0, 100% 1"></div>';
    const m = createMotion({ respectReducedMotion: false, inertia: 0, ease: 'ease-out' });
    m.init();
    const reasons = reasonsFor(m, 'd2');
    expect(reasons).toEqual([expect.stringContaining('an option, not an attribute')]);
    /** The part that matters: it must not claim an attribute the element does not have. */
    expect(reasons[0]).not.toContain('data-vm-ease=');
    expect(document.getElementById('d2').hasAttribute('data-vm-ease')).toBe(false);
    m.destroy();
  });
});
