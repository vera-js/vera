# @verajs/styles

`static styles` for VeraJS components (<!--size:styles.gzip-->520 B<!--/size:styles.gzip--> gzip): constructed stylesheets into shadow
roots, and `@scope`-wrapped hoisting for light DOM.

```js
import { insert } from '@verajs/core';
import { adoptStyles } from '@verajs/styles';

insert('init', adoptStyles, 50);
```

Once, at your app entry, next to `setRenderer`. Every component `init()` adopts its `static styles`
from that point on.

`insert` comes from **`@verajs/core`**, not from `@verajs/inserts`. A production `.min.js` inlines
the registry into every bundle, so registering through your own copy would write to a map core never
reads — working in development and silently doing nothing in production. Taking core's own `insert`
removes the question. Forget the wiring and core says so, once, in development.

**Shadow DOM** — constructed sheets go to `shadowRoot.adoptedStyleSheets`; plain strings become a
`<style vera-styles>` in the shadow root. Both are naturally scoped and safe to re-`init`.

**Light DOM** — styles are hoisted to the document once per component class, wrapped in
`@scope (tag-name) { … }` so they apply only inside that component's subtree: scoping without a
shadow root, done by the platform. Hoisting also survives renders, since a `<style>` inside the
element would be wiped by the first render pass.

`applyStyles(styles, element)` is exported for manual use.

This lived in `@verajs/core` until 0.2.0. It moved because most apps do not use `static styles` and
every app was paying for it. If a component declares `static styles` with this package absent, core
warns once in development.
