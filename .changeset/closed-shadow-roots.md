---
'@verajs/core': patch
'@verajs/styles': patch
'@verajs/inserts': patch
---

`init(element, { mode: 'closed' })` works.

`init` called `attachShadow` and discarded what it returned, and everything downstream read
`element.shadowRoot` — which is `null` for a closed root, by definition. So a closed component
rendered its content into the **light DOM**, never adopted its styles, and left an empty unreachable
shadow root behind. Measured with no SSR involved: `mode: 'closed'` put `<p>content</p>` in the light
DOM while `mode: 'open'` put it in the shadow root.

The root is kept on the element as `_root` — a cross-boundary contract like `_hooks`, read by the
`'render'` insert and by `@verajs/styles`, and never mangled. A second `init` on a closed element is
guarded, which `shadowRoot` alone could not do.

`tests/browser/shadow-modes.test.js` covers every mode as a matrix rather than testing the one bug:
content lands in the root, styles adopt into it and actually apply, and nothing leaks to the light
DOM. Light DOM is asserted to create no root at all.
