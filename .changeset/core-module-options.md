---
'@verajs/core': patch
'@verajs/inserts': patch
---

A module can own a key on a component's options: core hands `init({ host, … })`'s object to every `'init'` hook, and `wire` hands a connector itself

**Feature (for module authors):** an `'init'` hook now receives the component's options object beside the element, or
`undefined`. A module reads only its own key (slots reads `expectSlots`), and core never reads, copies or validates one.
For the key's type, a module adds it to the global `VeraInitOptions` interface that `InitOptions` extends
(`declare global { interface VeraInitOptions { myKey?: boolean } }`), so the key exists only where that module is
imported. For development's unknown-option check, it sets `$keys` on its hook function. Two modules claiming one key are
reported once (`option-claimed-twice`). An unknown key is ignored in both builds, as before, and development names it.

**Feature:** a connector, a function `wire` calls with the registry, is now also handed `wire` itself, so a module made
of several insert points can take options and still be wired bare, as `slots` does. Existing connectors ignore the second
argument. Production core grows by 1 B.
