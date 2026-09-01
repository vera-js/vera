---
'@verajs/renderer': minor
---

`render(result, container)` is now `renderInto(result, container)`, in `@verajs/renderer`,
`@verajs/renderer/hydrate` and `@verajs/renderer/profiler` alike.

```js
import { renderInto } from '@verajs/renderer';
renderInto(html`<p>${count}</p>`, document.querySelector('#app'));
```

Nothing else changes: same signature, same lit-html argument order, same behaviour. `wire([renderer])`
registers this function, so a component's `render()` still ends up here.

**Why.** `render` named two different public functions. Core's takes a template *function*, subscribes
it to every store it reads, and commits a component's setup; the renderer's takes a template *result*
and a container, and writes once. Both were documented, so a reader who knew one misread the other.

`renderElement` and `renderDom` were considered and rejected — this renders *into* a container, not
*an* element, and the container is a `Node`, so a shadow root and a fragment are both valid and
"element" would be a lie in the type. `renderIn` reads identically to `renderLn` in most sans-serif
faces.

`tests/docs-moved-render.test.mjs` guards it, because `tests/docs-removed-apis.test.mjs` structurally
cannot: that list is keyed by name, and `render` still exists — in the other package.
