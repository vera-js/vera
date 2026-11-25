---
'@vera-components/kbd': patch
---

A key's corners are a share of the shared `--vera-radius` (.35 of it, 3.5px by default), so the token that rounds every
other component rounds keys too, and a keycap stays a keycap at any radius an app picks. Its border and fill still mix
from `currentColor`, so a key keeps the color of the text it sits in.
