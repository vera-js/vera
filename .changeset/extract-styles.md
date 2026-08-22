---
'@verajs/core': minor
'@verajs/inserts': patch
'@verajs/ssr': patch
---

**Breaking:** `static styles` adoption has moved out of core into the new `@verajs/styles` package,
and `adoptStyles` is no longer exported from `@verajs/core`. Wire it once at your app entry:

```js
import { insert } from '@verajs/core';
import { adoptStyles } from '@verajs/styles';
insert('init', adoptStyles, 50);
```

A component declaring `static styles` with nothing adopting them now warns once in development,
naming the three lines to add. Production is unaffected — the warning is behind `__DEV__`.

Core drops from 3 101 B to 2 801 B gzipped, and a working app (core + renderer) from 6 091 B to
5 759 B — below Lit and Preact + signals again. Apps that use `static styles` add `@verajs/styles`
(520 B) back; apps that do not simply stop paying for it.

`@verajs/inserts` gains a fifth extension point, `'init'`, which core dispatches once per element
after its shadow root exists and before its first render. That is the seam the extraction needed,
and it is available to any module that wants to see every component as it comes to life.
