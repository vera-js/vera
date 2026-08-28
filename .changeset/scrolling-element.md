---
'@verajs/ssr': patch
---

`document.scrollingElement` is the `documentElement`

It was `null`, which is the answer a *quirks-mode* document gives — and this document declares
`compatMode: 'CSS1Compat'` two lines above, so it was contradicting itself. A component reading
`document.scrollingElement.scrollTop`, which every engine allows, threw a `TypeError` on the server
and worked in the browser.

Measured on Chromium, Firefox and WebKit; all three answer `documentElement`.
