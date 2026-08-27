---
'@verajs/autoloader': patch
---

Report a module that imports cleanly and defines nothing

`await import(src)` then `await customElements.whenDefined(tag)` — and if the module loads but never
defines *that* tag, `whenDefined` simply never settles. The `catch` never runs, so there is no console
line, no `vera:autoload-error` event, and the element sits unupgraded for the life of the page. A
blank space with a clean console.

The everyday cause is a typo: markup says `<my-widget>`, the file defines `my-wdiget`. It is now
reported through both channels, with a message naming the likely cause.

A dynamic `import()` resolves only after the module has fully evaluated, top-level `await` included,
so by that point every `customElements.define` the module was going to run has run. Two microtask
turns are drained first anyway, covering a define deferred by a resolved promise. The wait is **not**
abandoned — `whenDefined` is still awaited, so a definition that does arrive late still upgrades and
still gets watched. The error is a report, not a refusal.
