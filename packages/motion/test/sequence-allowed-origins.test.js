/**
 * The allowlist accepts the ways a site owner would plausibly write it.
 *
 * `parseUrl` compares against `URL.origin` — scheme + host + port, never a
 * trailing slash. So `allowedOrigins: ['https://cdn.test/']` matched nothing,
 * and neither did `'cdn.test'` or `'https://cdn.test/path'`: three of the four
 * plausible spellings refused every frame, with the reason reported against the
 * element rather than against the allowlist that caused it.
 *
 * It failed **closed**, which is why this was a usability defect and not a
 * security one — but a security boundary that silently does nothing is the
 * worst kind of silent, because the owner believes they opted a host in.
 */
import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { expect, vi } from './expect.mjs';
import { sequence } from '../src/sequence.ts';
import { createMotion, wireMotion } from '../src/index.ts';

let warnings;
beforeEach(() => {
  warnings = [];
  vi.spyOn(console, 'warn').mockImplementation((...args) => warnings.push(String(args[0])));
});
afterEach(() => vi.restoreAllMocks());

/** Wired fresh per test, because the allowlist is captured when the factory runs. */
const withAllowlist = (allowedOrigins) => {
  wireMotion(sequence({ allowedOrigins }));
  document.body.innerHTML =
    '<canvas id="c" data-vm data-vm-frame="0% 0, 100% 9" ' +
    'data-vm-frame-url="https://cdn.test/seq/" data-vm-frame-count="10"></canvas>';
  const m = createMotion({ respectReducedMotion: false });
  m.init();
  const url = m.elements[0]?.parsed.settings['frame-url'];
  m.destroy();
  return url;
};

describe('allowedOrigins spellings', () => {
  it('accepts a bare origin', () => {
    expect(withAllowlist(['https://cdn.test'])).toBe('https://cdn.test/seq/');
  });

  it('accepts one with a trailing slash', () => {
    expect(withAllowlist(['https://cdn.test/'])).toBe('https://cdn.test/seq/');
  });

  it('accepts one carrying a path, using its origin', () => {
    expect(withAllowlist(['https://cdn.test/some/path'])).toBe('https://cdn.test/seq/');
  });

  it('still refuses an origin that was never listed', () => {
    expect(withAllowlist(['https://other.test'])).toBeUndefined();
  });

  /**
   * A bare host cannot be resolved without guessing a scheme, and guessing
   * `https:` for something the owner may have meant as `http:` is not a favour
   * to do silently on a security boundary.
   */
  it('refuses a bare host, and says why', () => {
    expect(withAllowlist(['cdn.test'])).toBeUndefined();
    expect(warnings.some((w) => w.includes('is not a url'))).toBe(true);
  });

  it('an unusable entry does not take the usable ones with it', () => {
    expect(withAllowlist(['cdn.test', 'https://cdn.test'])).toBe('https://cdn.test/seq/');
  });
});
