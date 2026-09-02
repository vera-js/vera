/**
 * Changing the split mode re-splits — on `collect()`.
 *
 * Two things were in the way and only one was a defect.
 *
 * **The defect:** `prepare` skipped any node already in its map, whatever the
 * attribute now said, so a node split as `words` stayed words forever. The map
 * holds the mode it used now, and a different one means restore and re-split.
 *
 * **Not a defect:** an attribute change alone still does nothing, and must.
 * `prepare` deliberately never runs from inside the mutation observer, because
 * a module that rewrites the DOM re-enters the observer by construction —
 * CLAUDE.md is explicit, and content added after `init()` is the same story.
 * `collect()` is the public path, and these tests use it because that is the
 * contract, not as a workaround.
 *
 * So a GUI editor must call `collect()` after changing a split mode. That
 * was true before and is now written down in `docs/modules/split.md`.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { split } from '../src/split.ts';

wireMotion(split);

const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

const A = 'data-vera-motion';
const page = (mode) => {
  document.body.innerHTML =
    `<p id="p" ${A} ${A}-split="${mode}" ${A}-opacity="0% 0, 100% 1">ab cd</p>`;
  return document.getElementById('p');
};
const pieces = (node) => [...node.querySelectorAll('span[aria-hidden]')].map((s) => s.textContent);

describe('switching the split mode', () => {
  it('does nothing on the attribute change alone, by design', async () => {
    const node = page('words');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    node.setAttribute(`${A}-split`, 'chars');
    await settle();
    expect(pieces(node)).toEqual(['ab', 'cd']);
    m.destroy();
  });

  it('words to chars', async () => {
    const node = page('words');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(pieces(node)).toEqual(['ab', 'cd']);

    node.setAttribute(`${A}-split`, 'chars');
    m.collect();
    await settle();
    expect(pieces(node)).toEqual(['a', 'b', 'c', 'd']);
    m.destroy();
  });

  it('chars back to words', async () => {
    const node = page('chars');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    expect(pieces(node)).toEqual(['a', 'b', 'c', 'd']);

    node.setAttribute(`${A}-split`, 'words');
    m.collect();
    await settle();
    expect(pieces(node)).toEqual(['ab', 'cd']);
    m.destroy();
  });

  it('keeps the text intact across the change', async () => {
    const node = page('words');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    node.setAttribute(`${A}-split`, 'chars');
    m.collect();
    await settle();
    /** The visible half: piece text plus spaces, the hidden copy excluded. */
    const visible = [...node.childNodes]
      .filter((n) => !(n.nodeType === 1 && !n.hasAttribute('aria-hidden')))
      .map((n) => n.textContent).join('');
    expect(visible).toBe('ab cd');
    m.destroy();
    expect(document.getElementById('p').textContent).toBe('ab cd');
  });

  /**
   * Re-splitting on every collect would churn the DOM for nothing. This used to set a new
   * `-opacity` on the container as its trigger — which is not the no-op case, it is an edit,
   * and edits re-split now (see below). A plain re-collect is the thing that must be cheap.
   */
  it('does not re-split when nothing about the container changed', async () => {
    const node = page('words');
    const m = createMotion({ respectReducedMotion: false, inertia: 0 });
    m.init();
    const first = node.querySelector('span');
    m.collect();
    await settle();
    /** The same element object, not a replacement. */
    expect(node.querySelector('span')).toBe(first);
    m.destroy();
  });
});

/**
 * The other edit a split container can receive: an animation attribute, after the split.
 * Mode changes redid the split; attribute edits matched the same-mode skip and were accepted
 * in silence — reached no piece, did nothing, said nothing (fixed 2026-09-01). The author's
 * fresh value must win over the restore's old one.
 */
it('re-splits when the container gains an animation attribute, and the edit wins', async () => {
  const node = page('words');
  const m = createMotion({ respectReducedMotion: false, inertia: 0 });
  m.init();
  expect(node.querySelectorAll('span[aria-hidden]').length > 0).toBe(true);

  /** The author adds a new animation attribute to the container itself. */
  node.setAttribute(`${A}-translate-y`, '0% 10px, 100% 0px');
  m.collect();
  await settle();

  const spans = [...node.querySelectorAll('span[aria-hidden]')];
  expect(spans.length > 0).toBe(true);
  for (const span of spans) {
    expect(span.getAttribute(`${A}-translate-y`)).toBe('0% 10px, 100% 0px');
  }
  /** Moved, as the originals were. */
  expect(node.hasAttribute(`${A}-translate-y`)).toBe(false);
  m.destroy();
});
