---
'@verajs/styles': minor
---

**Breaking: in the document a light component's defaults now sit in `@layer vera`, so any unlayered CSS you write beats them**, whatever its specificity (before, the `@scope` default won at equal specificity). With a layered framework, state `@layer theme, base, vera, components, utilities;` first in your CSS, before its import: the defaults then beat Tailwind's preflight and its utilities beat the defaults. Nothing is inserted to place it, so a Content-Security-Policy has nothing to refuse; development warns (`layer-order`) when a page holds layers and states no place for `vera`. A shadow root's block is unchanged, unlayered.
