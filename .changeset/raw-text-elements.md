---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A binding inside `<iframe>` or `<noscript>` no longer paints the renderer's marker onto the page.

The renderer marks a child slot with `<?…>`, which a parser turns into a comment — except inside an
element whose children it reads as text, where it stays characters and never becomes a part.
`RAW_TEXT_TAGS` listed four such elements and there are six.

- `html`<iframe>${v}</iframe>`` rendered the literal marker — `<?$v8hpsho$>` — and never updated, in
  **all three engines**.
- `html`<noscript>${v}</noscript>`` did the same **in Firefox only**. A template's contents are parsed
  with the scripting flag disabled, which is what decides whether `noscript` is raw text, and
  Chromium and WebKit parse it as markup there while Firefox parses it as text. So an app developed
  in Chrome shipped the framework's internal syntax onto the page for Firefox users.

`@verajs/ssr` was missing the same two, so its DOM built a tree no browser builds:
`<noscript><img src="x"></noscript>` parsed to an element and `querySelectorAll('noscript img')`
answered `1` where every engine answers `0`.

Both lists were measured across Chromium, Firefox and WebKit rather than read off a spec — and jsdom
is not the oracle here: it parses with scripting disabled, so it agreed with the old list about
`noscript` while all three real engines disagreed with both.
