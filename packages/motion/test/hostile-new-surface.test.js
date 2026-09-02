import { describe, it } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { wireMotion } from '../src/index.ts';
import { createMotion } from '../src/index.ts';
import { createSequence } from '../src/modules/sequence.ts';

wireMotion(sequence);

describe('hostile input on surface added during the audit', () => {
  it('frame-ext cannot smuggle anything into the url', () => {
    const hostile = [
      'jpg/../../etc/passwd', 'jpg?x=1', 'jpg#frag', 'jpg" onerror="alert(1)',
      '../../secret', 'jpg\\..\\..', 'JPG', 'jpeg;', ' jpg', 'jpg ',
      'https://evil.test/x.jpg', 'data:text/html,x',
    ];
    /** Whitespace-padded valid values are trimmed by design, not smuggling. */
    const trimmedToValid = new Set([' jpg', 'jpg ']);
    const accepted = [];
    for (const ext of hostile) {
      document.body.innerHTML =
        `<canvas data-vm data-vm-frame="0% 0, 100% 9" ` +
        `data-vm-frame-url="/s/" data-vm-frame-count="10" ` +
        `data-vm-frame-ext="${ext.replace(/"/g, '&quot;')}"></canvas>`;
      const m = createMotion({ respectReducedMotion: false });
      m.init();
      const value = m.elements[0]?.parsed.settings['frame-ext'];
      if (value !== undefined && !trimmedToValid.has(ext)) {
        accepted.push(`${JSON.stringify(ext)} -> ${JSON.stringify(value)}`);
      }
      m.destroy();
    }
    expect(accepted).toEqual([]);
  });

  it('builds the url only from allowlisted parts', () => {
    document.body.innerHTML = '<canvas id="c"></canvas>';
    const node = document.getElementById('c');
    node.getContext = () => ({ drawImage: vi.fn() });
    const seen = [];
    const RealImage = globalThis.Image;
    globalThis.Image = class {
      set src(v) { seen.push(v); }
      get src() { return ''; }
      /** Real images have this; `abandon` cancels an unwanted fetch through it. */
      removeAttribute() {}
    };
    const s = createSequence(node, { url: 'https://site.test/s/', frames: 3, ext: 'webp', pad: 2 });
    s.draw(0);
    globalThis.Image = RealImage;
    for (const url of seen) expect(url).toMatch(/^https:\/\/site\.test\/s\/\d{2}\.webp$/);
    s.destroy();
  });

  it('a very large attribute value does not blow up the diagnostics', () => {
    const huge = 'z'.repeat(400_000);
    document.body.innerHTML = '';
    const node = document.createElement('div');
    node.setAttribute('data-vm', '');
    node.setAttribute('data-vm-opacity', huge);
    document.body.append(node);
    const m = createMotion({ respectReducedMotion: false });
    const started = Date.now();
    m.init();
    const ms = Date.now() - started;
    const total = m.rejected.flatMap((r) => r.rejected).join('').length;
    /** Bounded by the attribute the page already contains, and fast. */
    expect(ms).toBeLessThan(1000);
    expect(total).toBeLessThanOrEqual(huge.length + 200);
    m.destroy();
  });

  it('a flood of unknown attributes is bounded by the element itself', () => {
    const node = document.createElement('div');
    node.setAttribute('data-vm', '');
    for (let i = 0; i < 500; i++) node.setAttribute(`data-vm-junk${i}`, 'x'.repeat(200));
    document.body.innerHTML = '';
    document.body.append(node);
    const m = createMotion({ respectReducedMotion: false });
    const started = Date.now();
    m.init();
    const ms = Date.now() - started;
    const reported = m.rejected.flatMap((r) => r.rejected);
    /** Names are reported, never values — the value is the attacker-sized part. */
    expect(reported.every((r) => r.length < 120)).toBe(true);
    expect(ms).toBeLessThan(1000);
    m.destroy();
  });
});
