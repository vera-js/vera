---
'@verajs/renderer': patch
'@verajs/core': patch
'@verajs/inserts': patch
---

A throwing `&ref` reaches the `'error'` insert, and an error nothing handles reaches `window.onerror`

**`@verajs/renderer`:** an element ref that threw was caught and printed with `console.error`, but
never reached the `'error'` insert a throwing effect reaches, so an error boundary could not see it.
It now goes through the same chain, handed the component being rendered (a shadow root resolves to
its host), exactly as core hands a hook's error. The render still continues past it.

**`@verajs/core` and `@verajs/renderer`:** with no `'error'` handler wired, a hook or ref error went to
`console.error` alone — so `window.onerror`, error trackers and test runners that listen for page
errors stayed silent while a component had stopped updating. It now goes to `reportError`, which
fires the window's `error` event without unwinding, so one failure still never stops its siblings.
Development prints the `[vera]` sentence beside it; off-browser, where there is no `reportError`, the
console is used as before.

**`@verajs/inserts`:** the `'error'` insert's documentation says what now reaches it.
