---
'@verajs/styles': patch
---

The `styles` option: `define({ tag, styles: css`…` }, setup)` and `init({ host, styles })`

A component with no class of its own takes its styles as an option — the same values as `static styles`, adopted the
same way (a shadow root's sheets, or light DOM hoisted once per document, scoped to the tag). The option wins when both
are given, and `styles: null` means none. A `define` tag's option is remembered once per tag, so a component's creation
pays nothing for it. Core changes nothing for this.
