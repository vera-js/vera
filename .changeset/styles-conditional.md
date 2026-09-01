---
'@verajs/styles': patch
'@verajs/inserts': patch
---

`static styles = [base, isDark && darkSheet]` no longer crashes the component.

That idiom produces `[sheet, false]`, and it broke both of `applyStyles`' paths, differently, and
neither of them legibly. In the shadow DOM `escapeStyleText(false)` threw `value.replace is not a
function` out of `connectedCallback`, from a file the author has never opened, taking the component
with it. In the light DOM nothing threw at all: `false.cssText` is `undefined`, so the literal text
`undefined` was joined into the stylesheet and hoisted to the document. A ternary yielding `null`
threw a third message one step earlier.

A falsy entry now means "no styles here", which is what the top of `applyStyles` already reads a
falsy `styles` argument to mean — the same rule applied to the members of an array. CSS that is
genuinely not CSS is refused by name in development, as `adoptStyles` and the element argument
already were.

Separately, `wire` no longer warns that "the second replaced the first" when the second **is** the
first. An app whose entry points share a wiring module wires `styles` from each of them; the callback
was identical, nothing was replaced, and the advice it gave — use different priorities — would have
made it run twice. It fired in this repo's own kitchen-sink example, which is the reference
application, and a warning the reference app trips on is one people learn to scroll past. Two
*different* modules claiming one priority still warn, which is the failure it exists for.
