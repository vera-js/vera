import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion } from '../src/index.ts';
import { parseElement } from '../src/modules/parse.ts';
import { createRuntimeElement, updateStateElement, updateElement } from '../src/modules/runtime.ts';

const ctx = { origin: 'https://example.com/' };
const S = { scrollDirection: 'vertical', inertia: 0.1, inertiaEase: 'linear', ease: 'linear'};
const win = (start = 0) => ({ start, end: start + 900, size: 900, width: 1400, height: 900 });

const build = (html) => {
  document.body.innerHTML = html;
  const node = document.body.firstElementChild;
  Object.defineProperty(node, 'offsetTop', { value: 1000, configurable: true });
  Object.defineProperty(node, 'offsetHeight', { value: 300, configurable: true });
  Object.defineProperty(node, 'offsetParent', { value: null, configurable: true });
  return createRuntimeElement(parseElement(node, ctx), S);
};

const opacity = (e) => /opacity\(([\d.]+)\)/.exec(e.node.style.filter)?.[1] ?? null;

beforeEach(() => { document.body.innerHTML = ''; });

describe('data-vm-when — the driver', () => {
  it('sits at the start while the selector does not match', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    updateStateElement(e, true);
    expect(opacity(e)).toBe('0');
  });

  it('moves to the end when it matches', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    updateStateElement(e, true);
    e.node.classList.add('open');
    updateStateElement(e);
    expect(opacity(e)).toBe('1');
  });

  it('goes back to the start when it stops matching', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    e.node.classList.add('open');
    updateStateElement(e, true);
    expect(opacity(e)).toBe('1');

    e.node.classList.remove('open');
    updateStateElement(e);
    expect(opacity(e)).toBe('0');
  });

  it('does nothing when the match has not changed', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    updateStateElement(e, true);
    expect(updateStateElement(e)).toBe(false);
  });

  /** Any selector, not just a class — which is why it takes one. */
  it.each([
    ['a class', '.open', (n) => n.classList.add('open')],
    ['an id', '#panel', (n) => (n.id = 'panel')],
    ['an attribute', '[aria-expanded="true"]', (n) => n.setAttribute('aria-expanded', 'true')],
    ['a compound', '.a.b', (n) => n.classList.add('a', 'b')],
  ])('matches on %s', (_label, selector, apply) => {
    const e = build(`<div data-vm data-vm-when='${selector}' data-vm-opacity="0% 0, 100% 1"></div>`);
    updateStateElement(e, true);
    expect(opacity(e)).toBe('0');
    apply(e.node);
    updateStateElement(e);
    expect(opacity(e)).toBe('1');
  });

  it('honours every keyframe between the ends', () => {
    const e = build(`<div data-vm data-vm-when=".open"
      data-vm-translate-y="0% 40px, 50% 10px, 100% 0px"
></div>`);
    updateStateElement(e, true);
    expect(e.node.style.transform).toBe('translateY(40px)');
    e.node.classList.add('open');
    updateStateElement(e);
    expect(e.node.style.transform).toBe('translateY(0px)');
  });

  it('gets the damping transition, so it eases rather than snaps', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    expect(e.transition).toContain('filter');
  });
});

describe('data-vm-when — replaces the scroll driver', () => {
  it('ignores scroll entirely', () => {
    const e = build('<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>');
    updateStateElement(e, true);
    updateElement(e, win(4000), S);   // would be past the end if scroll-driven
    expect(opacity(e)).toBe('0');
  });

  it('a scroll-driven element is unaffected by the state path', () => {
    const e = build('<div data-vm data-vm-opacity="0% 0, 100% 1"></div>');
    expect(updateStateElement(e, true)).toBe(false);
    expect(e.when).toBeNull();
  });
});

/** run-once has to mean the same thing on both drivers. */
describe('data-vm-when + run-once', () => {
  it('latches on the first match and does not go back', () => {
    const e = build(`<div data-vm data-vm-when=".open" data-vm-run-once
      data-vm-opacity="0% 0, 100% 1"></div>`);
    updateStateElement(e, true);
    e.node.classList.add('open');
    updateStateElement(e);
    expect(opacity(e)).toBe('1');

    e.node.classList.remove('open');
    updateStateElement(e);
    expect(opacity(e)).toBe('1');      // latched, exactly as on scroll
    expect(e.runOnceRan).toBe(true);
  });

  it('without run-once it toggles both ways', () => {
    const e = build(`<div data-vm data-vm-when=".open"
      data-vm-opacity="0% 0, 100% 1"></div>`);
    e.node.classList.add('open');
    updateStateElement(e, true);
    e.node.classList.remove('open');
    updateStateElement(e);
    expect(opacity(e)).toBe('0');
    expect(e.runOnceRan).toBe(false);
  });
});

describe('end to end', () => {
  it('paints the resting state at init', () => {
    document.body.innerHTML = '<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.elements[0].node.style.filter).toContain('opacity(0)');
    a.destroy();
  });

  it('starts at the end when the selector already matches', () => {
    document.body.innerHTML = '<div class="open" data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.elements[0].node.style.filter).toContain('opacity(1)');
    a.destroy();
  });

  /** enable() used to call update(), which skips state-driven elements by design. */
  it('repaints state-driven elements after a disable/enable cycle', () => {
    document.body.innerHTML =
      '<div class="open" data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    const node = a.elements[0].node;
    expect(node.style.filter).toContain('opacity(1)');

    a.disable();
    expect(node.style.filter).toBe('');
    a.enable();
    expect(node.style.filter).toContain('opacity(1)');
    a.destroy();
  });

  /**
   * This used to assert that `when="a, script"` was refused, under the name
   * "a hostile selector". A selector is **parsed, not evaluated** — the
   * validator's own docs say it is not an injection sink and nothing in it can
   * become code — so a list of two element names is not hostile, it is a list.
   *
   * It is accepted now: `when` is evaluated with `matches()`, where `a, b`
   * means "either", and refusing it came from `path-selector`'s reasoning
   * about `querySelector` returning the first match of any.
   */
  it('accepts a selector list, which means either', () => {
    document.body.innerHTML = `<div class="panel" data-vm data-vm-when=".menu-open, .panel" data-vm-opacity="0"></div>`;
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.elements[0].when).toBe('.menu-open, .panel');
    expect(a.elements[0].parsed.rejected).toEqual([]);
    a.destroy();
  });

  /** What refusal is actually for: a selector the engine cannot parse. */
  it.each(['div >', '.', '.open!', '   '])('refuses %s, which no parser accepts', (bad) => {
    document.body.innerHTML = `<div data-vm data-vm-when="${bad}" data-vm-opacity="0"></div>`;
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.elements[0].when).toBeNull();
    expect(a.elements[0].parsed.rejected.join(' | '))
      .toContain('data-vm-when: is not a selector this library will use');
    a.destroy();
  });

  /** And `:has()`, which is refused for cost rather than for safety. */
  it('refuses :has(), which can be expensive on every mutation', () => {
    document.body.innerHTML = `<div data-vm data-vm-when=":has(.x)" data-vm-opacity="0"></div>`;
    const a = createMotion({ respectReducedMotion: false });
    a.init();
    expect(a.elements[0].when).toBeNull();
    a.destroy();
  });
});

/**
 * The whole point of splitting the observer callbacks: a class toggle must not
 * rebuild the element. Rebuilding would re-parse every attribute, re-measure
 * geometry, and destroy any attached image sequence — on every toggle.
 */
describe('a class toggle does not rebuild the element', () => {
  const settle = () => new Promise((r) => setTimeout(r, 0));

  it('keeps the same element object across a toggle', async () => {
    document.body.innerHTML =
      '<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();

    const before = a.elements[0];
    const node = before.node;
    node.classList.add('open');
    await settle();

    expect(a.elements).toHaveLength(1);
    expect(a.elements[0]).toBe(before);   // same object — not re-adopted
    a.destroy();
  });

  it('does not discard an attached sequence on a toggle', async () => {
    document.body.innerHTML =
      '<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();

    const destroySpy = vi.fn();
    a.elements[0].sequence = { draw: vi.fn(), destroy: destroySpy };

    a.elements[0].node.classList.add('open');
    await settle();

    expect(destroySpy).not.toHaveBeenCalled();
    expect(a.elements[0].sequence).not.toBeNull();
    a.destroy();
  });

  /** A data-vm-* change is different: it changes what the element animates. */
  it('does rebuild when one of its own attributes changes', async () => {
    document.body.innerHTML =
      '<div data-vm data-vm-when=".open" data-vm-opacity="0% 0, 100% 1"></div>';
    const a = createMotion({ respectReducedMotion: false });
    a.init();

    const before = a.elements[0];
    before.node.setAttribute('data-vm-opacity', '0.5');
    await settle();

    expect(a.elements[0]).not.toBe(before);   // re-parsed, as it must be
    a.destroy();
  });
});

/**
 * A `when` selector this library cannot be told about.
 *
 * `when` is re-evaluated when an **attribute** changes, because that is what
 * the mutation observer can see. `:hover`, `:focus`, `:active`, `:target` and
 * `:checked` are none of them attribute state — hovering writes nothing, focus
 * writes nothing, `:target` follows the fragment, and a checkbox's `checked`
 * *property* moves without its attribute. So the selector parsed, matched
 * nothing at the moments anyone looked, and the element sat at one end of its
 * animation for ever.
 *
 * `docs/ATTRIBUTE-REFERENCE.md` has said exactly this — "will not be noticed —
 * use CSS for those" — while the runtime accepted it in silence. Documented as
 * not working and allowed anyway, which is the shape `translate-z` without a
 * perspective had.
 */
describe('a `when` selector made of state the observer cannot see', () => {
  const PREFIX = 'data-vm';
  const build = (selector) => {
    document.body.innerHTML =
      `<div class="on" ${PREFIX} ${PREFIX}-when="${selector}" ` +
      `${PREFIX}-opacity="0% 0, 100% 1"></div>`;
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    return m;
  };
  const said = (m) => m.rejected.flatMap((entry) => entry.rejected ?? []).join(' | ');

  it.each([':hover', ':focus', ':active', ':target', ':checked', ':focus-within'])(
    'refuses %s and names it',
    (pseudo) => {
      const m = build(`.on${pseudo}`);
      /**
       * `uses ${pseudo}`, not just `${pseudo}` — the message echoes the whole
       * selector, so a bare `toContain(pseudo)` passes without the detection
       * having found anything at all. It did: `focus` came before
       * `focus-within` in the alternation, so a `:focus-within` selector was
       * reported as `:focus` and this test was satisfied by the echo.
       */
      expect(said(m)).toContain(`uses ${pseudo}`);
      expect(said(m)).toContain('that state is not an attribute');
      m.destroy();
    }
  );

  /**
   * The setting is dropped, so the element animates on scroll like any other —
   * what a refused setting does everywhere else here. It is a visible
   * consequence rather than a quiet one, so the message says it.
   */
  it('drops the setting, so the element is scroll-driven again', () => {
    const m = build('.on:hover');
    expect(m.elements[0].when, 'not held at one end for ever').toBeNull();
    expect(said(m)).toContain('animates on scroll instead');
    m.destroy();
  });

  /** And an ordinary class selector is untouched. */
  it('says nothing about a selector it can actually watch', () => {
    const m = build('.on');
    expect(said(m)).toBe('');
    expect(m.elements[0].when).toBe('.on');
    m.destroy();
  });
});
