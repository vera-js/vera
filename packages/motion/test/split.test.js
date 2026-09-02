import { describe, it, beforeEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { split } from '../src/split.ts';
import { wireMotion } from '../src/index.ts';
import { createSplit } from '../src/modules/split.ts';
import { createMotion } from '../src/index.ts';
import { parseElement } from '../src/modules/parse.ts';

wireMotion([split]);

const el = (html) => {
  document.body.innerHTML = html;
  return document.body.firstElementChild;
};
const pieces = (node) => [...node.querySelectorAll('[data-vera-motion]')];
/** The visually-hidden copy that carries the readable sentence — real text, not aria-label. */
const copyOf = (node) => node.querySelector(':scope > span:not([aria-hidden])');
/** What a sighted reader sees: everything except the hidden copy. */
const visible = (node) =>
  [...node.childNodes].filter((n) => n !== copyOf(node)).map((n) => n.textContent).join('');

beforeEach(() => { document.body.innerHTML = ''; });

describe('createSplit', () => {
  it('splits into characters, keeping spaces as plain text', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0% 0, 100% 1">ab cd</p>');
    createSplit(node, 'chars');
    expect(pieces(node).map((p) => p.textContent)).toEqual(['a', 'b', 'c', 'd']);
    /** The space survives as a text node, so wrapping behaves as before. */
    expect(visible(node)).toBe('ab cd');
    expect(copyOf(node).textContent, 'the hidden copy carries the sentence').toBe('ab cd');
  });

  it('splits into words', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0% 0, 100% 1">the quick fox</p>');
    createSplit(node, 'words');
    expect(pieces(node).map((p) => p.textContent)).toEqual(['the', 'quick', 'fox']);
    expect(visible(node)).toBe('the quick fox');
  });

  it('preserves runs of whitespace rather than collapsing them', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">a   b</p>');
    createSplit(node, 'words');
    expect(visible(node)).toBe('a   b');
  });
});

describe('text the bidi algorithm would reorder', () => {
  /**
   * Pieces are atomic inline-blocks and lay in source order, so a run
   * opposing the paragraph direction is visually scrambled by splitting —
   * measured in all three engines (`spikes/split-bidi.mjs`). Refused, with
   * the fix in the sentence, exactly as nested markup is.
   */
  it('refuses a Hebrew run inside an LTR paragraph', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">before שלום עולם after</p>');
    expect(createSplit(node, 'words')).toBeNull();
    expect(node.querySelectorAll('span')).toHaveLength(0);
  });

  it('refuses a Latin run inside an RTL paragraph', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">שלום hello עולם</p>');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' });
    expect(createSplit(node, 'words')).toBeNull();
    vi.restoreAllMocks();
  });

  it('splits an RTL paragraph of its own script — source order is reading order there', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">שלום עולם</p>');
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ direction: 'rtl' });
    const made = createSplit(node, 'words');
    expect(made).not.toBeNull();
    expect(node.querySelectorAll('span[aria-hidden]')).toHaveLength(2);
    made.destroy();
    vi.restoreAllMocks();
  });
});

describe('what moves to the pieces and what stays', () => {
  /**
   * The bug this pins down was found in a browser, not here: `stagger` was
   * being moved onto the pieces along with everything else, which left the
   * parent no longer a stagger host and every piece animating in unison —
   * exactly what splitting is for. The unit tests missed it because the
   * failure is the *absence* of a cascade.
   */
  it('leaves stagger and split on the container', () => {
    const node = el(`<p data-vera-motion data-vera-motion-split="chars" data-vera-motion-stagger="3"
      data-vera-motion-opacity="0% 0, 100% 1">ab</p>`);
    createSplit(node, 'chars');
    expect(node.getAttribute('data-vera-motion-stagger')).toBe('3');
    expect(node.getAttribute('data-vera-motion-split')).toBe('chars');
    expect(pieces(node).some((p) => p.hasAttribute('data-vera-motion-stagger'))).toBe(false);
  });

  it('moves the animation attributes off the parent and onto every piece', () => {
    const node = el(`<p data-vera-motion data-vera-motion-opacity="0% 0, 100% 1"
      data-vera-motion-translate-y="0% 20px, 100% 0px">ab</p>`);
    createSplit(node, 'chars');
    expect(node.hasAttribute('data-vera-motion-opacity')).toBe(false);
    expect(node.hasAttribute('data-vera-motion-translate-y')).toBe(false);
    for (const p of pieces(node)) {
      expect(p.getAttribute('data-vera-motion-opacity')).toBe('0% 0, 100% 1');
      expect(p.getAttribute('data-vera-motion-translate-y')).toBe('0% 20px, 100% 0px');
    }
  });

  it('moves per-element settings, which configure how a piece animates', () => {
    const node = el(`<p data-vera-motion data-vera-motion-opacity="0" data-vera-motion-inertia="0.4"
      data-vera-motion-ease="ease-in">ab</p>`);
    createSplit(node, 'chars');
    expect(pieces(node)[0].getAttribute('data-vera-motion-inertia')).toBe('0.4');
    expect(pieces(node)[0].getAttribute('data-vera-motion-ease')).toBe('ease-in');
  });

  it('produces pieces the parser accepts', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0% 0, 100% 1">ab</p>');
    createSplit(node, 'chars');
    const parsed = parseElement(pieces(node)[0], { origin: 'https://example.com/' });
    expect(parsed).not.toBeNull();
    expect(parsed.animations[0].property.attribute).toBe('opacity');
  });
});

describe('accessibility', () => {
  it('keeps the original text readable — as a hidden copy, not aria-label', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">Hello there</p>');
    createSplit(node, 'chars');
    /**
     * ARIA 1.2 prohibits naming on generic/paragraph roles, so the label
     * shape rested on engine leniency. Real text needs no naming rule.
     */
    expect(node.hasAttribute('aria-label')).toBe(false);
    const copy = copyOf(node);
    expect(copy.textContent).toBe('Hello there');
    expect(copy.style.position, 'visually hidden, present for AT').toBe('absolute');
    expect(copy.style.getPropertyValue('user-select'), 'out of drag-selection').toBe('none');
    expect(copy.hasAttribute('aria-hidden')).toBe(false);
  });

  it('hides every piece from assistive technology', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">Hello</p>');
    createSplit(node, 'chars');
    expect(pieces(node).every((p) => p.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
});

describe('refusals', () => {
  /**
   * Every piece is a span *and* a registered animated element, so an
   * unbounded split enrols unbounded elements in the scroll loop.
   */
  it('refuses a text long enough to make an absurd number of pieces', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = el(`<p data-vera-motion data-vera-motion-opacity="0">${'word '.repeat(600)}</p>`);
    expect(createSplit(node, 'words')).toBeNull();
    expect(node.children.length).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('still splits an ordinary heading', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">Hello there</p>');
    expect(createSplit(node, 'chars')).not.toBeNull();
    expect(pieces(node)).toHaveLength(10);
  });

  it('refuses nested markup rather than dropping it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">Some <strong>bold</strong> text</p>');
    expect(createSplit(node, 'words')).toBeNull();
    /** Untouched: the markup and the attribute are both still there. */
    expect(node.querySelector('strong')).not.toBeNull();
    expect(node.hasAttribute('data-vera-motion-opacity')).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('refuses an element with no text', () => {
    expect(createSplit(el('<p data-vera-motion data-vera-motion-opacity="0">   </p>'), 'chars')).toBeNull();
  });
});

describe('destroy', () => {
  it('restores the text, the attributes and the markup exactly', () => {
    const html = '<p data-vera-motion data-vera-motion-opacity="0% 0, 100% 1" data-vera-motion-stagger="3">the quick fox</p>';
    const node = el(html);
    const split = createSplit(node, 'words');
    expect(node.children.length).toBeGreaterThan(0);

    split.destroy();
    expect(node.children.length).toBe(0);
    expect(node.textContent).toBe('the quick fox');
    expect(node.getAttribute('data-vera-motion-opacity')).toBe('0% 0, 100% 1');
    expect(node.getAttribute('data-vera-motion-stagger')).toBe('3');
    expect(node.hasAttribute('aria-label')).toBe(false);
  });

  it('is safe to call after a refresh', () => {
    const node = el('<p data-vera-motion data-vera-motion-opacity="0">ab cd</p>');
    const split = createSplit(node, 'words');
    split.refresh();
    split.destroy();
    expect(node.textContent).toBe('ab cd');
    expect(node.children.length).toBe(0);
  });
});

describe('teardown races the chunk', () => {
  /**
   * The split module arrives asynchronously, so destroy() can land while it is
   * still in flight. Found by audit: the guard was `!roots.size`, and destroy()
   * never clears `roots` — so it could never fire, and a torn-down instance
   * would still have its DOM rewritten and its pieces adopted into an array
   * that destroy() had just emptied.
   */
  it('does not split after destroy()', async () => {
    document.body.innerHTML =
      '<p id="t" data-vera-motion data-vera-motion-split="chars" data-vera-motion-opacity="0% 0, 100% 1">hello</p>';
    const animation = createMotion({ respectReducedMotion: false });
    animation.init();
    animation.destroy();

    /** Let the dynamic import settle. */
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    const node = document.getElementById('t');
    expect(node.children.length, 'text was split after destroy').toBe(0);
    expect(node.textContent).toBe('hello');
    expect(animation.elements).toHaveLength(0);
  });
});

describe('teardown races the font load', () => {
  it('split: fonts.ready must not rebuild after destroy', async () => {
    let release;
    const ready = new Promise((r) => { release = r; });
    Object.defineProperty(document, 'fonts', { value: { ready }, configurable: true });

    document.body.innerHTML = '<p id="t" data-vera-motion data-vera-motion-opacity="0">hello there</p>';
    const node = document.getElementById('t');
    const split = createSplit(node, 'lines');
    split.destroy();
    expect(node.textContent).toBe('hello there');

    release();
    await ready;
    await new Promise((r) => setTimeout(r, 0));
    expect(node.children.length, 're-split after destroy').toBe(0);
    expect(node.textContent).toBe('hello there');
  });
});

/**
 * One mistake, one reason.
 *
 * `split` carries an `allowed` list, so the schema refuses a bad mode on any
 * *marked* container — and the module refusing again there put the same
 * mistake in `rejected` twice, in two wordings, which is what a GUI renders
 * side by side. The module's own refusal covers the case core cannot see: an
 * unmarked container, where the bare marker is optional and nothing parses the
 * attribute at all.
 */
describe('an unknown split mode is reported exactly once', () => {
  const reasons = (markup) => {
    document.body.innerHTML = markup;
    for (const node of document.querySelectorAll('*')) {
      for (const [key, value] of [
        ['offsetTop', 300], ['offsetHeight', 40], ['offsetWidth', 200], ['offsetParent', null],
      ]) Object.defineProperty(node, key, { value, configurable: true });
    }
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const said = m.rejected.flatMap((entry) => entry.rejected);
    m.destroy();
    return said;
  };

  it('once on a marked container, from the schema', () => {
    const said = reasons('<p data-vera-motion data-vera-motion-split="sentences" data-vera-motion-opacity="0">Hi</p>');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/must be one of/);
  });

  it('and once on an unmarked one, from the module — the case core cannot see', () => {
    const said = reasons('<p data-vera-motion-split="sentences">Hi there</p>');
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/is not one of/);
  });
});
