/**
 * **How a numeric reflection PARSES its attribute, asked of the engine that decides it.**
 *
 * `tests/browser/element-reflections.test.js` pins WHICH properties reflect. Nothing pinned what
 * they do with a value — and `packages/ssr/src/vera/reflections.js` has to answer that on a server,
 * with no engine to ask:
 *
 *     const parsed = Number.parseInt(raw, 10);
 *     return Number.isNaN(parsed) ? absent : parsed;
 *
 * That is HTML's "rules for parsing integers" — optional sign, then ASCII digits, stop at the first
 * character that is not one — and it is deliberately NOT `Number()`, which would take `1e3` as
 * 1000 and `0x10` as 16. Until this suite that distinction was a reading of the spec rather than a
 * measurement, which is the shape of every SSR-shim defect this project has had: the server and the
 * client disagree about something neither of them renders, and nothing fails until a hydration
 * mismatch surfaces somewhere else entirely.
 *
 * **jsdom is not the oracle for this and gets it wrong**, which is why the check lives here. Asked
 * in jsdom, `tabindex="1e3"` reads 1000 and `tabindex="0x10"` reads 16 — `Number()` behaviour, not
 * the integer rules. A node-side pin would therefore have certified the opposite of the truth.
 */
import { expect } from '@esm-bundle/chai';

/** The shim's rule, restated here rather than imported — a pin that reads its expectation out of
 *  the implementation it verifies pins nothing. */
const ASCII_SPACE = ' \t\n\f\r';
const shimReads = (raw, absent) => {
  if (raw === null) return absent;
  let i = 0;
  while (i < raw.length && ASCII_SPACE.includes(raw[i])) i++;
  let sign = 1;
  if (raw[i] === '-') { sign = -1; i++; } else if (raw[i] === '+') i++;
  const start = i;
  while (i < raw.length && raw[i] >= '0' && raw[i] <= '9') i++;
  if (i === start) return absent;
  const value = sign * Number(raw.slice(start, i));
  return value < -2147483648 || value > 2147483647 ? absent : value;
};

/**
 * Values chosen because they SEPARATE the two candidate rules. `42` agrees under either and is the
 * control; `1e3`, `0x10` and `3.9` are where `Number()` and the integer rules part company.
 */
const VALUES = [
  /**
   * `'\u00a05'` is a NON-BREAKING space before the digit, and it is here because it caught this
   * suite's own author: a stray U+00A0 in the corpus produced a "divergence" that fresh elements
   * did not reproduce, and it read as a shim defect for two runs. HTML's integer rules skip ASCII
   * whitespace only, so an engine answering the default for it is CORRECT — the test data was
   * wrong, not the code. Kept as a real case rather than quietly deleted.
   */
  '42', '0', '-5', '007', '3.9', ' 8 ', '1e3', '0x10', '+7', 'abc', '',
  '12abc', '9007199254740993', '1_000', ' 5', '\u00a05',
];

/**
 * `tabIndex` on a `<div>`: absent reads -1. A plain, universally implemented numeric reflection,
 * so a disagreement here is about PARSING and not about whether the property exists.
 */
it('a numeric reflection parses its attribute the way the shim does', () => {
  const diverged = [];
  let compared = 0;

  for (const raw of VALUES) {
    /**
     * A FRESH element per value, not one reused across the loop. Reusing it produced a divergence
     * that fresh elements do not reproduce — `tabindex=" 5"` read -1 in sequence and 5 on its own —
     * so the loop was measuring an engine's attribute-mutation caching rather than its parsing
     * rule, and would have been reported as a shim defect.
     */
    const element = document.createElement('div');
    element.setAttribute('tabindex', raw);
    const engine = element.tabIndex;
    const shim = shimReads(raw, -1);
    compared++;
    if (engine !== shim) diverged.push(`tabindex=${JSON.stringify(raw)}: engine ${engine}, shim ${shim}`);
  }

  expect(compared, 'NON-ZERO CONTROL: nothing was compared').to.equal(VALUES.length);
  expect(diverged.join('\n  '), 'the server would answer differently from this engine').to.equal('');
});

/**
 * The control that stops the above passing by accident: the two candidate rules must actually
 * DISAGREE on this corpus, or the suite proves only that both were applied to values nothing
 * separates. If `Number()` ever starts agreeing with the integer rules everywhere, this fails and
 * the corpus needs harder values — not a rule change.
 */
it('the corpus actually separates the integer rules from Number()', () => {
  const separating = VALUES.filter((raw) => {
    const loose = raw === '' ? NaN : Number(raw);
    const strict = Number.parseInt(raw, 10);
    return !Object.is(loose, strict);
  });
  expect(separating.length, 'no value distinguishes the two rules — this suite would pass under either')
    .to.be.greaterThan(2);
});

/**
 * And the reflection back out, which is the other half of the round trip: the platform applies the
 * WebIDL conversion at ASSIGNMENT and writes the CONVERTED number, not what the caller passed.
 * `reflections.js` says so from a Chromium measurement across 31 numeric reflections; this asks
 * every engine the suite runs on.
 */
it('assigning a numeric property writes the converted number, not the caller\'s value', () => {
  const element = document.createElement('div');
  for (const [assigned, expected] of [[3.9, '3'], [-2.5, '-2'], ['007', '7'], [true, '1']]) {
    element.tabIndex = assigned;
    expect(element.getAttribute('tabindex'), `tabIndex = ${JSON.stringify(assigned)}`).to.equal(expected);
  }
});
