import { describe, it, beforeEach } from './harness.mjs';
import { expect } from './expect.mjs';
import { createMotion } from '../src/index.ts';

const settle = () => new Promise((r) => setTimeout(r, 30));
const place = (n, top = 500) => {
  Object.defineProperty(n, 'offsetTop', { value: top, configurable: true });
  Object.defineProperty(n, 'offsetHeight', { value: 200, configurable: true });
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

/**
 * Every feature, through the editor path: does it survive a disable/enable
 * toggle, and does it work at all for an element added after init?
 */
const CASES = [
  ['transform',        'data-vm-translate-y="0% 0px, 100% 40px"',        (n) => n.style.transform],
  ['filter',           'data-vm-opacity="0% 0.2, 100% 1"',               (n) => n.style.filter],
  ['radius',           'data-vm-radius-top-left="0% 60px, 100% 4px"',    (n) => n.style.borderTopLeftRadius],
  ['pin',              'data-vm-pin="30px" data-vm-opacity="0% 0, 100% 1"', (n) => `${n.style.position}/${n.style.top}`],
  ['will-change',      'data-vm-will-change data-vm-opacity="0% 0, 100% 1"', (n) => n.style.willChange],
  ['transform-origin', 'data-vm-transform-origin="top left" data-vm-scale="0% 1, 100% 2"', (n) => n.style.transformOrigin],
  ['band',             'data-vm-opacity="0% 0, 100% 1" data-vm-opacity-[0-3000]="0% 0.5, 100% 1"', (n) => n.style.filter],
  ['preset',           '',                                                       (n) => n.style.transform, 'fade-up'],
  ['when',             'data-vm-when=".on" data-vm-opacity="0% 0, 100% 1"', (n) => n.style.filter],
];

beforeEach(() => { document.body.innerHTML = ''; });

describe('every feature through the editor path', () => {
  it('every feature survives a disable/enable toggle', () => {
    const broken = [];
    const inert = [];
    for (const [name, attrs, read, marker = ''] of CASES) {
      document.body.innerHTML = `<div class="on" data-vm="${marker}" ${attrs}></div>`;
      const node = document.body.firstElementChild;
      place(node);
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      const before = read(node);
      /**
       * Positive control. Without it a feature that applies nothing at all
       * reads '' before and '' after, compares equal, and passes vacuously.
       */
      if (!before || before === '/' ) inert.push(`${name}: applies nothing (${JSON.stringify(before)})`);
      m.disable();
      m.enable();
      const after = read(node);
      if (before !== after) broken.push(`${name}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      m.destroy();
    }
    expect(inert).toEqual([]);
    expect(broken).toEqual([]);
  });

  it('every feature works for an element added after init', async () => {
    const broken = [];
    const inert = [];
    for (const [name, attrs, read, marker = ''] of CASES) {
      document.body.innerHTML = '<div id="host"></div>';
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();

      const host = document.getElementById('host');
      host.innerHTML = `<div class="on" data-vm="${marker}" ${attrs}></div>`;
      const late = host.firstElementChild;
      place(late);
      await settle();
      const lateValue = read(late);

      /** Control: the same markup present at init. */
      document.body.innerHTML = `<div class="on" data-vm="${marker}" ${attrs}></div>`;
      const early = document.body.firstElementChild;
      place(early);
      const m2 = createMotion({ respectReducedMotion: false, inertia: 0 });
      m2.init();
      const earlyValue = read(early);

      /** Same control: both being empty would compare equal and prove nothing. */
      if (!earlyValue || earlyValue === '/') inert.push(`${name}: applies nothing at init (${JSON.stringify(earlyValue)})`);
      if (lateValue !== earlyValue) broken.push(`${name}: added late ${JSON.stringify(lateValue)} vs at init ${JSON.stringify(earlyValue)}`);
      m.destroy(); m2.destroy();
    }
    expect(inert).toEqual([]);
    expect(broken).toEqual([]);
  });
});

/**
 * And the third editor gesture, which neither test above covers: **editing an
 * attribute while animation is switched off**.
 *
 * `disable()` strips every animated style, which the README calls returning
 * every element "to its natural un-animated state". A re-parse put them
 * straight back — `will-change: transform` on an element the page had just been
 * told is not animating, along with `transform-origin`, `offset-path` and the
 * `position: sticky` a `pin` writes. Through the mutation observer as much as
 * through `collect()`, which is to say through the ordinary way an editor
 * works: toggle animation off, keep editing.
 *
 * `enable()` re-styles everything it holds, so nothing is lost by waiting.
 */
describe('editing while disabled', () => {
  const styled = (node) =>
    [node.style.transform, node.style.filter, node.style.willChange,
      node.style.transformOrigin, node.style.position, node.style.transition]
      .filter(Boolean);

  it('writes nothing back onto an element it has released', async () => {
    const dirty = [];
    for (const [name, attrs, , marker = ''] of CASES) {
      document.body.innerHTML = `<div class="on" data-vm="${marker}" ${attrs}></div>`;
      const node = document.body.firstElementChild;
      place(node);
      const m = createMotion({ respectReducedMotion: false, inertia: 0.3 });
      m.init();
      m.disable();
      /** The premise: disable() really did clear it. */
      if (styled(node).length) dirty.push(`${name}: disable() left ${JSON.stringify(styled(node))}`);

      node.setAttribute('data-vm-rotate', '0% 0deg, 100% 45deg');
      await settle();

      if (styled(node).length) dirty.push(`${name}: an edit put back ${JSON.stringify(styled(node))}`);
      m.destroy();
    }
    expect(dirty).toEqual([]);
  });

  /**
   * And a paint already owed when `disable()` lands is dropped, not made.
   *
   * `observe()` adopts synchronously and paints on the next microtask, so there
   * is a window in which a write is owed to an element the instance is about to
   * release. Neither the queue-time guard nor the paint-time one covers it —
   * both see `enabled` as it was on their own side of the gap.
   */
  it('and drops a paint it owed when disable() landed first', async () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById('host');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML =
      '<div data-vm data-vm-will-change data-vm-opacity="0% 0, 100% 1"></div>';
    place(root.firstElementChild);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();

    m.observe(root);
    /** Adopted, and the write is owed. */
    expect(m.elements).toHaveLength(1);
    m.disable();
    await settle();

    expect(root.firstElementChild.style.willChange, 'the owed write never lands').toBe('');
    m.destroy();
  });

  /** And puts them back the moment it is enabled again. */
  it('and restores them on enable()', () => {
    document.body.innerHTML =
      '<div data-vm data-vm-will-change data-vm-opacity="0% 0, 100% 1"></div>';
    const node = document.body.firstElementChild;
    place(node);
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    m.disable();
    node.setAttribute('data-vm-opacity', '0% 0.2, 100% 1');
    m.collect();
    expect(node.style.willChange).toBe('');

    m.enable();

    /** `filter`, because `opacity` is a filter function here and not the CSS property. */
    expect(node.style.willChange).toBe('filter');
    m.destroy();
  });
});
