---
'@verajs/ssr': patch
---

Every bound attribute value is served double-quoted, whatever quoting the template used

A value that shared its attribute with statics or other holes — `title=pre${x}`, `title=${a}${b}`,
`title = ${x}` — was written into the markup unquoted, so a value containing a space ended the attribute:
plain text split into stray attributes, and a value carrying ` onmouseover=…` became a live event handler
in the served page. The client was never affected; it sets attributes through the DOM.

The server now writes each bound attribute once, the way the client's `setAttribute` stores it: the whole
value joined, escaped and double-quoted. A binding that is the whole value omits the attribute for `null`
and `undefined` in every quoting — a quoted one used to serve `title=""` where the client removes it — and
a `javascript:` URL or a bound `srcdoc` is refused in every position, not only inside quotes. Space around
`=` no longer stops a sigil binding (`?hidden = ${x}`, `onClick = ${fn}`) being read as one.
