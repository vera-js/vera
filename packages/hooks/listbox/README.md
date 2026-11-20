# @vera-hooks/listbox

The select behavior, headless: no markup and no styles. `@vera-components/select` is built on it; anyone building
their own component gets the same contracts without re-deriving them. Private until launch.

```js
import { listbox } from '@vera-hooks/listbox';
```

- **`listbox(element, config)`**: options, filtering, single/multi selection, the keyboard walk (disabled rows
  skipped, wrapping), open/close with dismissal (`@vera-hooks/light-dismiss`), and imperative wiring for
  user-supplied markup (`attach`). State is a `createStore` store, so a host template that reads it re-renders on
  exactly what it read.

`@verajs/core` and `@vera-hooks/light-dismiss` stay external in every build: a controller's stores must live in the
same core the app renders with. On a CDN page the import map resolves them; under a bundler the dependency dedupes.
