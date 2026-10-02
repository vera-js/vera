---
'@verajs/ssr': patch
---

A setter that throws `null` or `undefined`, and `options: null`, are reported by name

JavaScript can throw any value. When a component's setter threw `null` or `undefined`, either for a value from `props`
or for a bound `.prop`, the server's error message read `.message` off it and crashed with "Cannot read properties of
null", naming nothing the caller did. It now names the component and the property, with the thrown value as the
error's `cause`. And `renderToString(url, null)` (or any non-object `options`), possible from JavaScript, throws a
`TypeError` saying `options` must be an object, instead of an unnamed destructuring error.
