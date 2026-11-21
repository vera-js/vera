---
'@verajs/ssr': patch
---

A further hole in a sigil or event binding's value is never written into the tag. It was written outside the binding's
quotes, where a value could add attributes of its own (`@click="${fn} ${x}"`, `?hidden="${on} ${x}"`). 0.3.4's note
said such an attribute goes whole, static text included: that held only for a value with one hole. And after a dropped
binding's closing quote, text that starts the next attribute keeps a space before it instead of being joined to the
tag name.
