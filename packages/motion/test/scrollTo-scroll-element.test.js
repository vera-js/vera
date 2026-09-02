/**
 * A `scrollElement` selector that does not resolve.
 *
 * Both failures — a selector matching nothing, and one that is not valid CSS —
 * warn and fall back to `window`. An instance configured for a pane then
 * quietly scrolled the whole page instead, which on a page that *has* a pane is
 * a confusing thing to watch and an easy thing to mistype. The console said so;
 * the GUI that would show it reads `rejected`.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { createScrollTo } from '../src/modules/createScrollTo.ts';

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
  document.body.innerHTML =
    '<nav><a href="#one">one</a></nav><div id="pane"><section id="one"></section></div>';
});
afterEach(() => vi.restoreAllMocks());

describe('a selector that matches nothing', () => {
  it('is reported, not only warned', () => {
    const s = createScrollTo({ scrollElement: '#pain' });
    s.init();
    expect(s.rejected).toEqual([
      { node: null, reason: 'no element matched scrollElement "#pain"; using window.' },
    ]);
    expect(warnings).toHaveLength(1);
    s.destroy();
  });

  /**
   * `collect()` empties `problems`, and this one is a property of the instance
   * rather than of the current markup — it is just as true after a re-scan.
   */
  it('survives a re-collect', () => {
    const s = createScrollTo({ scrollElement: '#pain' });
    s.init();
    s.collect();
    expect(s.rejected).toHaveLength(1);
    s.destroy();
  });
});

describe('a selector that is not valid CSS', () => {
  it('is reported too', () => {
    const s = createScrollTo({ scrollElement: 'a[' });
    s.init();
    /**
     * The two failures now report *differently*, which they did not while this
     * was deduced from "a string option that came back as `window`". A
     * selector that matched nothing and a selector that is not valid CSS are
     * different mistakes — the first is a typo in a name, the second is a typo
     * in the grammar — and only the console could tell them apart before.
     */
    expect(s.rejected[0].reason).toContain('not valid CSS');
    expect(s.rejected[0].reason).not.toContain('no element matched');
    expect(s.rejected[0].node).toBeNull();
    s.destroy();
  });
});

describe('a selector that resolves', () => {
  it('says nothing', () => {
    const s = createScrollTo({ scrollElement: '#pane' });
    s.init();
    expect(s.rejected).toEqual([]);
    expect(warnings).toEqual([]);
    s.destroy();
  });

  it('and neither does a node passed directly, or the default', () => {
    const byNode = createScrollTo({ scrollElement: document.getElementById('pane') });
    byNode.init();
    expect(byNode.rejected).toEqual([]);
    byNode.destroy();

    const byDefault = createScrollTo();
    byDefault.init();
    expect(byDefault.rejected).toEqual([]);
    byDefault.destroy();
  });
});
