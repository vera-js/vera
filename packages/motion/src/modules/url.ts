/**
 * URL validation for attribute-supplied urls.
 *
 * Its own module because the only setting that needs it — `frame-url` — moved
 * to `@verajs/motion/sequence`, and 109 bytes of origin policy has no business
 * in the runtime of a page that fetches nothing.
 */
/**
 * Validates a url from an attribute.
 *
 * This is the fix for audit S1. The old parser handed an attribute value
 * straight to `new Image().src`, so anyone who could edit a block could make
 * every visitor's browser issue arbitrary outbound requests — an exfiltration
 * and visitor-tracking vector, and a referrer leak.
 *
 * Same-origin only by default. `allowedOrigins` opts specific hosts in, and is
 * an instance setting rather than an attribute so a block author cannot widen
 * their own boundary.
 *
 * @param raw the attribute value
 * @param baseOrigin the page origin to resolve relative urls against
 * @param allowedOrigins additional origins the site owner has opted into
 * @returns the resolved url, or null if it is not permitted
 */
export const parseUrl = (
  raw: string,
  baseOrigin: string,
  allowedOrigins: readonly string[] = []
): string | null => {
  const value = raw.trim();
  if (value === '') return null;

  /**
   * Reject anything that could be a scheme we do not want resolving —
   * javascript:, data:, blob:, vbscript: — before URL() gets a chance to
   * normalise it into something that looks benign.
   */
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^https?:/i.test(value)) {
    return null;
  }

  let resolved: URL;
  let base: URL;
  try {
    resolved = new URL(value, baseOrigin);
    /**
     * The base parses here too, inside the same failure path: a page whose own origin is not a
     * URL — `"null"` in a sandboxed iframe — must read as "nothing is permitted", not as a throw
     * escaping into whoever asked (#8: when in doubt, reject).
     */
    base = new URL(baseOrigin);
  } catch {
    return null;
  }

  /**
   * Load-bearing, and for a narrower reason than it looks. Established by
   * mutation testing: removing it left the whole suite green, so the first
   * version of this comment — which claimed it was the only thing stopping
   * `java<TAB>script:` — was wrong. `URL()` does strip tabs and newlines, so
   * that string evades the scheme test above and normalises into a real
   * `javascript:` URL; but its origin is `"null"`, and the same-origin check
   * below rejects it anyway.
   *
   * The scheme this actually catches is `blob:`. `bl<TAB>ob:https://site.test/x`
   * evades the scheme test the same way, and then normalises to an origin that
   * **equals the page's own** — so the origin check passes it and this line is
   * the only thing left. Verified against the real parser.
   */
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return null;
  }

  if (resolved.origin === base.origin) return resolved.href;
  if (allowedOrigins.includes(resolved.origin)) return resolved.href;

  return null;
};
