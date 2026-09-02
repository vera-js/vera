/**
 * The paint slot table under an editing session, and what exhausting it costs.
 *
 * The table only grows — a slot number is baked into curves already built, so
 * reusing one would repaint whatever still holds it in the wrong colour. The
 * module's docblock predicted the consequence ("an editing session mints a
 * slot per intermediate colour, forever") and `docs/modules/paint.md` now
 * prices it honestly: past the bound **every later colour is refused for the
 * life of the page**, and no instance-level recovery exists, because the table
 * is module state that outlives every instance.
 *
 * These tests exist so that stays true by measurement rather than by belief.
 * They are the reason a future change to the cap, or to when the table is
 * cleared, cannot quietly alter what an editor experiences.
 */
import { describe, it, before, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';

const mount = () => {
  document.body.innerHTML =
    '<div id="a" data-vm data-vm-background="0% #000000, 100% #ffffff"></div>';
  const node = document.getElementById('a');
  for (const [key, value] of [
    ['offsetTop', 900], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetParent', null],
  ]) Object.defineProperty(node, key, { value, configurable: true });
  return node;
};

const hex = (i) => `#${i.toString(16).padStart(6, '0')}`;

before(() => { wireMotion(paint); });
beforeEach(() => {
  Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (fn) => { fn(16); return 1; });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

/**
 * One test, not three: the table is module-level and cannot be emptied, so the
 * first test to exhaust it decides what every later one sees. The sequence is
 * the finding — reached, then unrecoverable — so it is asserted as a sequence.
 */
describe('the paint slot table under a long editing session', () => {
  it('accepts colours until the bound, then refuses every later one for good', () => {
    const node = mount();
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    /** The control: an ordinary edit applies, or nothing below is evidence. */
    node.setAttribute('data-vm-background', '0% #112233, 100% #ffffff');
    m.collect();
    expect(node.style.background).toBe('#112233');
    expect(m.rejected.flatMap((entry) => entry.rejected)).toEqual([]);

    /** A picker dragged: one distinct colour per step, re-parsed each time. */
    for (let i = 1; i <= 1200; i++) {
      node.setAttribute('data-vm-background', `0% ${hex(i)}, 100% #ffffff`);
      m.collect();
    }

    const said = m.rejected.flatMap((entry) => entry.rejected);
    expect(said.some((reason) => /distinct paint values/.test(reason))).toBe(true);

    /** Past the bound the newest colour does not reach the element. */
    node.setAttribute('data-vm-background', '0% #123456, 100% #ffffff');
    m.collect();
    expect(node.style.background).not.toBe('#123456');

    /**
     * And then the recovery, which is the half that took a new insert point.
     *
     * Destroying the last live instance fires `forget`, paint empties the
     * table — safe precisely because no instance means no curve means no slot
     * held — and an editor's ordinary destroy-and-rebuild works again. Before
     * that, this was a page-lifetime condition: `destroy()`, removing the
     * element and a fresh instance all left the table full, and only a reload
     * cleared it.
     */
    m.destroy();
    node.remove();
    const fresh = createMotion({ respectReducedMotion: false, inertia: 0 });
    fresh.init();
    const replacement = mount();
    fresh.collect();
    replacement.setAttribute('data-vm-background', '0% #654321, 100% #ffffff');
    fresh.collect();
    expect(replacement.style.background).toBe('#654321');
    /**
     * And the cap's own diagnostic is retracted with the table it described.
     * A GUI rendering `rejected` would otherwise show "the table is full" over
     * a table that is empty — the stale-condition shape this library refuses.
     */
    expect(fresh.rejected.flatMap((entry) => entry.rejected)).toEqual([]);
    fresh.destroy();
  });

  /**
   * The guard on the guard: `forget` must fire only when the **last** instance
   * goes. A module emptying page state while a second instance is still
   * animating would leave that instance's curves holding slot numbers for a
   * table that no longer has them — repainting elements in another element's
   * colours, which is the exact failure `discrete` and this table exist to
   * prevent.
   */
  it('does not empty the table while another instance is still live', () => {
    /**
     * Disjoint roots — the supported two-instance shape, and the one `owns`
     * answers exactly. Two instances over the *same* root is unsupported by
     * contract (they adopt each other's elements), so testing the guard that
     * way tests the unsupported configuration instead of the guard.
     */
    document.body.innerHTML =
      '<section id="one"><div id="a" data-vm data-vm-background="0% #abcdef, 100% #ffffff"></div></section>' +
      '<section id="two"><div id="b" data-vm data-vm-background="0% #fedcba, 100% #ffffff"></div></section>';
    const place = (node) => {
      for (const [key, value] of [
        ['offsetTop', 900], ['offsetHeight', 200], ['offsetWidth', 200], ['offsetParent', null],
      ]) Object.defineProperty(node, key, { value, configurable: true });
      return node;
    };
    const a = place(document.getElementById('a'));
    const b = place(document.getElementById('b'));

    const first = createMotion({ root: document.getElementById('one'), respectReducedMotion: false, inertia: 0 });
    const second = createMotion({ root: document.getElementById('two'), respectReducedMotion: false, inertia: 0 });
    first.init();
    second.init();
    /** The control: both painted, so the table genuinely holds both colours. */
    expect(a.style.background).toBe('#abcdef');
    expect(b.style.background).toBe('#fedcba');

    /**
     * One instance goes. `forget` must NOT fire: the other's curves still hold
     * slot numbers, and emptying the table under them leaves those numbers
     * indexing nothing.
     *
     * **Scrolled, not re-collected**, and that distinction is the whole test.
     * A `collect()` here re-parses the attribute and mints fresh slots, which
     * repairs the damage before it can be seen — a mutation firing `forget` on
     * every destroy survived a version of this test that called `collect()`.
     * Repainting from the *existing* curve is what reads the table through a
     * slot number decided earlier, so an emptied table shows up as the element
     * never reaching its second colour.
     */
    first.destroy();
    Object.defineProperty(window, 'scrollY', { value: 5000, configurable: true });
    second.refresh();
    expect(b.style.background).toBe('#ffffff');
    second.destroy();
  });
});
