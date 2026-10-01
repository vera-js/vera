---
'@verajs/renderer': patch
---

A tag component passes on props named like `Object.prototype` members

`@verajs/renderer/tag`'s JSX-component path looked prop names up in plain object tables, so `constructor`,
`toString`, `valueOf`, `hasOwnProperty` and `isPrototypeOf` were answered with the prototype's own functions, refused
as names, and silently dropped. They now reach the element like any other attribute. `__proto__` is still never a
prop.
