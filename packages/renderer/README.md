# @verajs/renderer

A keyed, template-identity renderer (<!--size:renderer.gzip-->3.54 KB<!--/size:renderer.gzip--> gzip): tagged templates, `.prop`/`?bool`/`@event`
and React-style `onClick` bindings, element refs, `keyed()` lists, `hold()` DOM preservation.
`@verajs/renderer/hydrate` is a drop-in superset whose first render ADOPTS server-rendered DOM —
markerless hydration (no framework comments in server HTML). SSR apps import from `/hydrate`;
everyone else pays zero hydration bytes.

## Escaping, and the deliberate absence of `unsafeHTML`

Every interpolated value is escaped at the render boundary. There is no `unsafeHTML` and there will
not be one: shipping a sanctioned opt-out puts an XSS sink in the public API, where it reads as
blessed in tutorials and in review.

Trusted markup goes through an element ref, so you write the sink yourself:

```js
render(html`<div ${(el) => (el.innerHTML = trustedMarkup)}></div>`, host);
```

Greppable, obviously yours, reviewable as the security decision it is. Sanitize first
(`DOMPurify.sanitize`) unless the markup is genuinely your own, and put it on an element whose
children nothing else binds — the renderer owns the content of elements it renders into.

`@verajs/renderer/profiler` is a development-only entry that reports how many templates were
committed in place versus torn down and rebuilt, naming the template pairs that churn and where.
`showProfiler()` puts the same information in a live panel in the corner of the page. It costs
production nothing — the instrumentation is removed by the build, not merely unused.

Wire once, at your app entry, before any component defines itself:

<!-- recipe -->
```js
import { init, createStore, render, setRenderer, html } from '@verajs/core';
import { render as domRender } from '@verajs/renderer';

setRenderer(domRender);

customElements.define(
  'click-counter',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ count: 0 });
      render(() => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`);
    }
  }
);

document.body.append(document.createElement('click-counter'));
```

Without `setRenderer`, core has no renderer at all: `render()` warns once in development and puts
nothing on the page. `@event`, `.prop` and `?bool` bindings are the first things to go missing.
