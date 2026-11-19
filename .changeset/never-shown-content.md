---
'@verajs/renderer': patch
'@verajs/ssr': patch
---

A value inside an element whose content is never shown as markup (`<iframe>`, `<noscript>`, and the obsolete `<xmp>`,
`<noembed>`, `<noframes>`, `<plaintext>`) renders as text, and stays text after the page is saved from the DOM and
parsed again. Such an element's content is written back verbatim, so a value holding `</noscript><img onerror=…>` was
inert on the live page and became markup once the page was saved (`outerHTML`, an editor's publish) and served again,
with scripting on or off. The renderer now writes each value there fully encoded: every ASCII character other than a
letter, digit or `_` as a character reference, which no parse can turn into a tag or an attribute. The obsolete four
are no longer refused. A template in any of these elements is refused (`template-in-text`), as in a `<style>`; on the
server, a template inside a `<noscript>` is refused too (`ssr-template-in-text`), where it used to render. The served
bytes of a value there are unchanged (escaped as text) and differ from the client's; hydration rewrites that text
rather than adopting it.
