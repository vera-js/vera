---
'@verajs/ssr': patch
---

Twenty-two more tags reflect their properties, including `<template>`'s declarative shadow DOM.

Three findings in a row — `option.text`, `form.action` and `table.width` answering as plain JavaScript
properties rather than reflections — each traced to the same root: not a member somebody skipped, but
a **tag nobody measured**. `table`, `tr`, `tbody`, `div`, `p`, `ul`, `template` and sixteen more were
absent from the list `scripts/measure-element-reflections.mjs` walks.

**51 properties added**, every one measured on Chromium, Firefox and WebKit and recorded only where
all three agree. Mostly the legacy presentational attributes — `align`, `bgColor`, `cellPadding`,
`vAlign`, `compact` — which are deprecated, still reflected by every engine, and therefore still reach
markup the moment a component assigns one.

`template.shadowRootMode` is the one that matters most here: this package **emits** that attribute for
declarative shadow DOM, so a component reading it back was asking about markup this renderer wrote and
getting `undefined`.

The tag list in the measurement script is updated too, so a regeneration keeps them.
