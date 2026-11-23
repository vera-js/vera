---
'@verajs/ssr': patch
---

The server's DOM refuses what browsers refuse, with the same error name: `createElement` with a name whose first
character is not an ASCII letter and does not follow the engines' rule (`'1a'`, `'-a'`), or with no argument (and
`createTextNode()`, `createComment()`); `attachShadow` on an element that cannot host a shadow root; setting a
`dataset` key with a hyphen before a lowercase letter; a prefixed `setAttributeNS` name its namespace does not allow;
inserting the document as a child; appending a child to text or a comment. A selector it cannot read now throws a
`SyntaxError` `DOMException`. Each of these used to be accepted, or refused with a different error, so the server
rendered markup the browser would not have built from the same calls.
