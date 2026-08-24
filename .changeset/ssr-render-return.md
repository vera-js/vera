---
'@verajs/ssr': patch
---

A non-template return from `render()` flattens the way the client flattens it.

A string was written straight into `innerHTML`, so a component returning `'<b>raw</b>'` produced real
elements on the server and the escaped text `&lt;b&gt;raw…` in the browser. Different content on the
two paths — and an injection the client does not have, the moment any of that string comes from data.
A number returned nothing at all here and `42` there.

Everything that is not a template now goes through the same flattening a slot's value does, which is
where all the escaping already lived.
