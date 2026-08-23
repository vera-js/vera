---
'@verajs/ssr': patch
'@verajs/styles': patch
---

Escape `</style>` in CSS text before it reaches a `<style>` element. **Security fix.**

`css` is a plain concatenation and escapes nothing, deliberately — the constructed-stylesheet path
must receive exactly the CSS the author wrote. `@verajs/ssr` then wrapped that text in
`<style>…</style>`, and `<style>` is a raw-text element: the HTML tokenizer scans it for one thing,
its end tag. A value interpolated into `css` and carrying `</style>` closed the element, and
everything after it parsed as markup. Verified against a real parser: it built an `<img>` with a
live `onerror`. Reachable wherever an application themes from a value it does not fully control.

The client was never directly exploitable — fragment parsing into a `<style>` creates no nodes,
confirmed in Chromium, Firefox and WebKit — but it produced a DOM whose *serialization* was
poisoned, which is one round trip away from the same result.

Fixed at the sinks rather than in `css`: `@verajs/ssr` when it writes a `<style>` and when it hands
back hoisted light-DOM styles for the caller to place, and `@verajs/styles` before assigning to a
`<style>` element, which now uses `textContent` rather than `innerHTML` since the content is text
and nothing there should ever be parsed. Escaping in `css` itself would corrupt the constructed
stylesheet, which is exactly the double-escaping principle #8 warns against, and could not see a
sequence assembled across several interpolations.

`escapeHtml` is the wrong tool here and would break every stylesheet, because `>` is a child
combinator. Only the end-tag sequence is rewritten, to `<\/style` — valid CSS that renders
identically, asserted against `getComputedStyle` in all three engines. Selectors, media queries,
`url()` and ordinary declarations are untouched.

Costs `@verajs/styles` 29 B gzipped.
