---
'@verajs/ssr': patch
---

A shadow root opened with `slotAssignment: 'manual'` is served as one: its template carries
`shadowrootslotassignment="manual"`. Served without it, the root arrived assigning by name, which `attachShadow`
reuses as it is, so the component's `slot.assign()` calls did nothing and every child showed in the default slot.
Measured in Chromium, Firefox and WebKit. The README's known limit for manual slot assignment is gone.
