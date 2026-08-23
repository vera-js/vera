---
'@verajs/renderer': minor
'@verajs/jsx': patch
---

Move `spread` into `@verajs/renderer/spread`. **Breaking:** `@verajs/spread` is retired.

```js
- import { spread } from '@verajs/spread';
+ import { spread } from '@verajs/renderer/spread';
```

Nothing about the implementation changes. It extends the renderer's template language and speaks the
renderer's `_$apply$` protocol, so a separate top-level name put it where nobody would look for it.
A package earns its own name when it is a capability you install on purpose; a primitive extending
something else's surface belongs as an entry in that thing.

It is the one renderer entry that is **additive** rather than a substitute. The others inline
`./renderer.js` and carry their own template cache, so two must never load together; this one
imports nothing at all and is safe alongside any of them.

`@verajs/jsx` emits the new specifier for `{...props}`, configurable as before.
