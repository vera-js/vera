---
'@verajs/ssr': patch
---

`.value`, `.checked` and `.selected` mirror to attributes only on form elements.

That mirroring exists so hydration can read form state back out of the markup, which only means
anything on a form control. Applied to every element, `.value` on a `<b>` wrote `value="…"`
server-side where the client sets a plain JS property and no attribute at all — a difference in the
rendered DOM for no benefit. Anywhere but `input`, `textarea`, `select` and `option`, a `.prop` is
client state, which is what it already was everywhere else.

Applies to `@verajs/renderer/spread` on the same terms.
