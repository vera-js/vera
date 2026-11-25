---
'@verajs/styles': patch
---

A light component's scoped styles are built once per class instead of for every instance it renders, so a page of
many instances hoists them faster. A class keeps the first styles it is given, as its adopted sheet already did.
