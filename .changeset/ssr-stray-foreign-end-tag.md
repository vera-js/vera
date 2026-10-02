---
'@verajs/ssr': patch
---

Security: a stray `</svg>` inside `<math>` (or `</math>` inside `<svg>`, `</noscript>` inside either) no longer makes the server read what follows as HTML

The server escapes every value inside `<svg>`/`<math>`, where a `<style>` is a foreign element whose content is
markup. An end tag that closed nothing the template had opened still lowered its foreign depth, as if it closed an
element a parent opened. So `html`<math></svg><style>${text}</style></math>`` served `text` unescaped as raw text,
although the browser ignores that `</svg>` and parses the `<style>` as MathML, and a value carrying
`<img src=x onerror=…>` became a live element. The same happened to a child template whose stray end tag sat inside
its parent's `<math>`. Such an end tag now changes nothing; at worst a value is escaped where it did not need to be.
This was never in a published version.
