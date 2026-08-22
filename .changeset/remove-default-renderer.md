---
'@verajs/core': minor
---

**Breaking:** core no longer ships a default renderer. `@verajs/core` on its own cannot render;
wire one once at your app entry:

```js
import { setRenderer } from '@verajs/core';
import { render as domRender } from '@verajs/renderer';
setRenderer(domRender);
```

`render()` with no renderer registered now warns once in development, naming those exact lines.
Production carries no warning — it is behind `__DEV__`.

The default renderer existed so core alone would render *something* without a renderer module. It
did not deliver that: it serialized to a string and assigned `innerHTML`, so `@event`, `.prop` and
`?bool` bindings ended up in the DOM as literal attributes. Both README quick-starts relied on it
and both were broken — they rendered `<button @click="">Clicked 0 times</button>` and clicking did
nothing. Both are fixed and verified in this release.

Core drops from 2 801 B to 2 577 B gzipped, and a working app from 5 759 B to 5 588 B.

`defaultRenderer` is no longer exported. If you were using it deliberately, the closest equivalent
is `@verajs/renderer`, which is what every documented path already used.
