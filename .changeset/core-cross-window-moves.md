---
'@verajs/core': patch
'@verajs/renderer': patch
'@verajs/styles': patch
---

A component moved into another window — a `window.open` pop-out or an iframe — and back is kept

Moving a component into another window's document with plain DOM no longer tears it down and sets it up again: its
state survives the trip both ways. Its `useEffect` and `useLayoutEffect` run their cleanups and run again against the
new window, and `@verajs/styles` applies its styles again (a move empties a shadow root's adopted stylesheets). Content
rendered while it is out is built in its own window's realm, so child components created there work in every engine
(Firefox and Safari left them inert). A built-in host set up through `@verajs/renderer/native-elements` behaves the
same. Read the window inside an effect rather than in setup; remove and re-append a component to reset it.
