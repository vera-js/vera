---
'@verajs/ssr': patch
---

A component's own light DOM reaches the markup, and the registry refuses a redefinition.

**Light-DOM content was discarded for every shadow component.** It is what a `<slot>` projects, so a
component that put content there itself had it on the page in the browser and missing from the
server's markup — the slot rendering nothing. It now follows the shadow template, where the DOM puts
it.

**`children` arrive before `connectedCallback`**, which is where a client finds them: the parser has
already built them when the element upgrades. A component can now read or slot what it was passed,
and one that overwrites its own light DOM wins — the same order, the same result.

**`customElements.define` refuses a second definition**, as the platform does. Overwriting silently
meant a module defining a tag twice rendered fine on the server and threw `NotSupportedError` in the
browser. A server being lenient about an error is a server hiding it.
