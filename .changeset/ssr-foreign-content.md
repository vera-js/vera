---
'@verajs/ssr': patch
---

The server's DOM now parses SVG and MathML content when it is read: self-closing tags, SVG's mixed-case element and
attribute names, and the integration points (`<foreignObject>`, `<desc>`, `<title>`, MathML's token elements, an
HTML-encoded `<annotation-xml>`), with each element built in its namespace. Markup it cannot reproduce, such as an HTML
element written inside SVG content, is still declined rather than parsed differently. HTML's name-keyed rules (raw text,
void elements, the leading newline of `<pre>`) now apply to HTML elements only, so text written into an SVG or MathML
element of the same name, such as an SVG `<style>`, is escaped as text.
