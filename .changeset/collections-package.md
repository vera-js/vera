---
'@verajs/core': minor
'@verajs/inserts': patch
---

Reactive `Map`/`Set` moves out of core, to `@verajs/collections`

Most stores hold plain objects, and every app was carrying 367 B gzipped for collections it never
created. An app without a `Map` in a store is now **292 B smaller**; one with a `Map` pays **24 B**
over having it built in.

```js
+ import { collections } from '@verajs/collections';
- wire([domRender]);
+ wire([domRender, collections]);
```

Forget it and core raises a development error naming the package the first time a collection is read
from a store — then the call throws, because native collection methods cannot run on a proxy. It
fails loudly, not silently.

`@verajs/inserts` gains the `'collection'` insert point this rides on. Unlike `'proxy-handler'`,
which runs on every read of every store, it is **type-keyed**: core dispatches it only when the
target is already known to be a `Map` or `Set`, and resolves it once per process. That is what makes
the split affordable — it is the same shape that made `@verajs/map-support` too expensive in its
first incarnation.
