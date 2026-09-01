---
'@verajs/ssr': patch
---

Three form-property rules where there was one, and a carriage return that cannot round-trip in RAWTEXT

**`value` is not one rule, it is three, and a `== null` test collapsed them.** Measured in Chromium,
Firefox and WebKit rather than assumed: `<input>` and `<textarea>` carry `[LegacyNullToEmptyString]`
in their IDL, so `null` alone means the empty string while `undefined` goes through the ordinary
ToString and is the text `"undefined"`; `<option>` has neither rule and gives `"null"`. The server
treated `null` and `undefined` as the same value everywhere, and `<textarea>` additionally emptied
booleans — so `.value=${true}` served an empty control where the browser shows `true`, disagreeing
with `<input>` one branch below it.

Written bindings and spread keys were both wrong, in three separate branches of the same rule.
`tests/ssr-spread-equivalence.test.mjs` caught the third on its own, which is the check working.

**A carriage return cannot survive inside `<style>` or `<script>`, and the README now says so.** The
fix that made `&#13;` carry a CR through applies to text, attributes and RCDATA. RAWTEXT is the
branch it cannot reach: a browser does not decode a character reference inside those two elements —
that is what makes them RAWTEXT — while the input-stream preprocessor still collapses the raw CR.
There is no spelling that survives, so it is listed beside NUL and the lone surrogate rather than
claimed as fixed, and the README's "and are the only two" is now three. Reached in practice by an
interpolated stylesheet whose source has Windows line endings, which a checkout with
`core.autocrlf=true` produces for every template literal.

All three behaviours are asserted against the engines in `tests/browser/rawtext-carriage-return.test.js`
and `tests/browser/form-property-coercion.test.js`; jsdom is never the oracle for a parser or IDL rule.

## If you render server-side without hydrating

Every change above makes the server agree with the client, so a **hydrating** app sees the same page
it always saw — the difference was the mismatch, and the mismatch is what went away. A **static** SSR
consumer has no client to agree with, and for them these are visible output changes:

| written | before | now |
| --- | --- | --- |
| `<input .value=${undefined}>` | `<input>` | `<input value="undefined">` |
| `<textarea .value=${true}>` | empty | `true` |
| `<p title="a ${[1, 2]} b">` | `a 12 b` | `a 1,2 b` |
| `${Symbol('s')}` at any position | `Symbol(s)` | **throws** |

Each new answer is the one a browser gives, which is why it changed — but `undefined` becoming the
visible text `"undefined"` is a surprise worth knowing about rather than discovering. It was always
what the client showed after hydration; only the server was hiding it.
