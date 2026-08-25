# @verajs/autoloader

Lazy component loading by tag name — <!--size:autoloader.gzip-->1.07 KB<!--/size:autoloader.gzip-->
gzipped, no dependencies, no build step required.

When an undefined custom element appears inside a component marked `autoloader`, its module is
fetched and defined. No manifest, no import list, no bundler plugin: the tag name *is* the module
name.

Discovery is **observed, not polled**. A marked component is watched once, so an element is found
whenever it enters the DOM — put there by a render, by `innerHTML`, by a third-party widget, or by
having been in the HTML file all along.

```sh
npm i @verajs/autoloader
```

## Quick start

```js
import { wire } from '@verajs/core';
import { autoloader } from '@verajs/autoloader';

const autoload = autoloader(import.meta.url, 'components');
wire(autoload);            // watch every component as it renders
autoload();                // and scan whatever is already on the page
```

```html
<my-page autoloader>
  <user-card></user-card>   <!-- fetches components/user-card.js the first time it appears -->
</my-page>
```

`rootDir` is almost always `import.meta.url` — every component URL is resolved relative to it, and
omitting `componentsDir` puts components beside the entry file.

`autoloader` returns **one function with three shapes**, plus two helpers:

| | |
| --- | --- |
| `autoload()` | scan the page for `[autoloader]` hosts and watch them |
| `autoload(element)` | watch that component |
| `autoload(shadowRoot)` | watch that root — no attribute needed, handing it over is the opt-in |
| `autoload.url(tag)` | the absolute URL it would fetch — **throws** if it would resolve outside `rootDir` |
| `autoload.retry(element)` | forget that this element's tag failed, and try again |

The instance is **also its own `wire` descriptor** — it carries `on: 'render'` at priority 75, so
`wire([renderer, autoload])` configures and installs in one call, and the scan runs after the
render that produced the markup. It replaced `setAutoloader`, a bespoke registrar that lived in
`@verajs/inserts`; every module now hands `wire` a descriptor, and this one is no exception.

Watching is idempotent: calling it twice on the same root does nothing the second time, which is why
it can be handed every component on every render.

Creating an autoloader does nothing on its own — no scanning, no listeners. `autoload()` is how a
hand-written page works with no framework involved at all, and you can call it again whenever new
markup lands:

```html
<script type="module">
  import { autoloader } from '@verajs/autoloader';
  autoloader(import.meta.url, 'components')();
</script>

<div autoloader>
  <user-card></user-card>   <!-- loads, though nothing here renders -->
</div>
```

A module script is deferred, so it runs after the page has parsed and the markup above is already
there.

## Attributes

| | |
| --- | --- |
| `autoloader` | on a component, scan its tree for undefined elements. **Opt-in, per component** |
| `autoload-dir` | on an element, load it from a different directory |
| `autoload-ignore` | on an element, leave it alone. Applies to that element only, not its subtree |

Scanning is per-component on purpose: the insert scans the element's own tree, not the shadow roots
of its descendants, so each component that hosts lazily-loaded children carries the attribute.

It is `autoload-dir`, never HTML's global `dir` — `dir="rtl"` on any internationalised page would
otherwise have silently redirected component loading.

**All three are watched, not just read once.** Marking a component `autoloader` after it already has
a shadow root reaches inside it; repointing `autoload-dir` after a failed attempt tries the new
location; removing `autoload-ignore` lets an element load. None of that needed a re-insertion, which
is not a thing that happens.

## Options

```js
autoloader(import.meta.url, 'components', { extension: '.ts' });
```

**`extension`** defaults to `.js`, with or without the leading dot. Set `.ts` so a TypeScript dev
server can autoload sources directly — it will not serve `foo.js` when only `foo.ts` exists.

**`resolve(tag, dir)`** replaces URL building entirely, for a layout `dir/tag.ext` cannot express:

```js
autoloader(import.meta.url, 'components', {
  resolve: (tag, dir) => `${dir}/${tag}/${tag}.js`,   // components/user-card/user-card.js
});
```

`dir` is the element's `autoload-dir` if it has one, otherwise `componentsDir`. The result is still
resolved against the entry file and still bounded by it, so a custom layout cannot reach anywhere
the default one could not.

## Bounding

**Every resolved URL must stay inside the entry file's own directory**, and one that does not is
refused with a console error rather than fetched. Tag names cannot carry a `/` — the HTML parser
will not produce one — but `autoload-dir` is free text on an element, and turning markup into a
module URL is exactly the thing that needs bounding.

```html
<x-y autoload-dir="https://example.com/x"></x-y>   <!-- refused: absolute -->
<x-y autoload-dir="//example.com/x"></x-y>         <!-- refused: protocol-relative -->
<x-y autoload-dir="../../../"></x-y>               <!-- refused: escapes upward -->
```

A custom `resolve` is checked the same way. `rootDir` is your own code and is trusted; everything
derived from the DOM is not.

The check lives in `url()`, which is the one place a URL is built — so it holds for the loader and
for **you**. `autoload.url(tag, element)` throws rather than returning something the loader would
refuse: it is documented for preloading, and a `<link rel="modulepreload">` pointed at another
origin is the exact fetch this module declines to make. Discovery catches the throw, reports it once
and moves on, so a hostile attribute costs a console line rather than a broken page.

## One attempt per URL, one module per tag

A URL is tried once per page load: a component that 404s logs once and is not retried until reload.

A **tag** is loaded once too, which is a different question. `<x-y>` and `<x-y autoload-dir="alt">`
are two URLs for one tag; both used to import, and the second module's `customElements.define('x-y')`
threw. A tag can only be defined once, so the second location could never have helped — it is tried
only if the first attempt fails.

## When a component never arrives

A failed load logs, and dispatches `vera:autoload-error` on the element — bubbling and composed,
with `{ tag, src, error, element }` on `detail`. That is the hook for rendering around a component that is
not coming:

```js
document.addEventListener('vera:autoload-error', ({ detail }) => {
  report(detail.error);
  detail.element.replaceWith(fallback());
});
```

An element that has not arrived *yet* needs no hook — it is simply un-upgraded, which is what
`:not(:defined)` in your CSS is for.

## Warming and recovering

`autoload.url(tag)` gives you the URL and gets out of the way, so warming is whatever you want it to
be — `modulepreload` for a component you know is coming, a lower-priority prefetch, priming a service
worker cache:

```js
const link = document.createElement('link');
link.rel = 'modulepreload';
link.href = autoload.url('user-card');
document.head.appendChild(link);
```

It is also the fastest answer to *why is it fetching that?* — the question this module gets asked
most.

`autoload.retry(element)` forgets that an element's tag failed and tries it again. A failed load is
otherwise permanent for the page, which is right for a component that does not exist and wrong for
one lost to a dropped connection. `vera:autoload-error` hands you the element:

```js
addEventListener('vera:autoload-error', ({ detail }) => {
  if (navigator.onLine) return;
  addEventListener('online', () => autoload.retry(detail.element), { once: true });
});
```

## Reaching a shadow root nothing marked

An observer cannot cross a shadow boundary, so a component that never marks itself is out of reach —
including a third-party one holding tags of yours. Hand the root over directly and it is watched;
passing it *is* the opt-in, so no attribute is required:

```js
autoload(someWidget.shadowRoot);
```

## Server-rendered pages

Markup from `@verajs/ssr` arrives as declarative shadow DOM, parsed before any script runs, with
nothing rendering it. `autoload()` reaches through those shadow roots the same as any other, so a
server-rendered page loads its components with no framework involvement:

```html
<ssr-shell autoloader>
  <template shadowrootmode="open">
    <ssr-child></ssr-child>       <!-- found by autoload() -->
  </template>
</ssr-shell>
```

## What it does not do

Watching does not cross into a child component's shadow root on its own — a `MutationObserver`
cannot, by design — so a child that hosts lazily-loaded elements of its own marks itself
`autoloader`, or has its root handed over as above. Vera components get this automatically, because
the `'render'` insert offers each one up as it renders.

## What it costs

One `MutationObserver` object watches every marked root, and a mutation only notifies observers on
its own ancestor chain — so watched subtrees that are not the ones changing cost nothing. Measured
in Chromium: 1 000 registrations left unrelated DOM work at 0.900 µs against 0.933 µs with none, and
watching a root adds ~0.6 µs per mutation batch into it.

Observers are never disconnected, and do not need to be: a removed node observed by a live observer
is still collectable — measured in Chromium with `--expose-gc`, and pinned by
`tests/browser/memory.test.js`. (jsdom disagrees, and disagrees even after `disconnect()`, which is
its own bookkeeping rather than the observer contract.)

This replaced a rescan of each marked component's whole tree on every render, which cost 0.46 µs for
a 10-node component, 3.4 µs at 100 nodes and **32.5 µs at 1 000** — on every render, for the life of
the page, long after everything had loaded. Watching `document` instead of each marked root would
have been the expensive shape: it taxes every DOM mutation in the app by ~47%, because every
mutation is inside it.

## License

MIT
