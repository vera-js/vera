---
'@verajs/core': patch
---

Document what a shadow root does to ARIA, and prove the ways through

`docs/CODE-PRINCIPLES.md` says accessibility is not a follow-up, `init(this, { mode: 'open' })` is the
documented way to write a component, and nothing anywhere said what that costs.

**Every ID-based ARIA relationship resolves within a single tree.** `aria-labelledby`,
`aria-describedby` and `<label for>` all match by ID, and IDs do not cross a shadow boundary — so a
page-level label cannot name a control inside a component. There is no error and no warning, just an
element with no accessible name. That is the platform's rule, not this framework's, and it is now in
the core README beside the `init` entry that creates it, and in `llms.txt`.

Three ways through, each with a browser test rather than a claim: keep the relationship inside one
template; put a role and name on the **host** with `ElementInternals`, which lives in the outer tree
(`attachInternals()` before `init`, which does not clobber it); or use light DOM, where `static
styles` still applies. `delegatesFocus: true` forwards host focus to the first focusable child.

Documentation only — no behaviour changed. `tests/browser/aria-shadow-boundary.test.js` establishes
the platform rule and executes all three recommendations in Chromium, Firefox and WebKit, because
advice that has not been run is a guess.
