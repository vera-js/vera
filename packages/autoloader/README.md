# @verajs/autoloader

Lazy component loading by tag name — <!--size:autoloader.gzip-->583 B<!--/size:autoloader.gzip-->
gzipped, no dependencies, no build step required.

The first time an undefined custom element appears inside a component marked `autoloader`, its
module is fetched and defined. No manifest, no import list, no bundler plugin: the tag name *is* the
module name.

```sh
npm i @verajs/autoloader
```

## Quick start

```js
import { setAutoloader } from '@verajs/core';
import { initAutoloader } from '@verajs/autoloader';

setAutoloader(initAutoloader(import.meta.url, 'components'));
```

```html
<my-page autoloader>
  <user-card></user-card>   <!-- fetches components/user-card.js the first time it appears -->
</my-page>
```

`initAutoloader(rootDir, componentsDir?, options?)` returns the discovery function.
`setAutoloader` registers it on the `'render'` insert at priority 75, so discovery runs *after* the
render that produced the markup. `rootDir` is almost always `import.meta.url`; every component URL
is resolved relative to it, and omitting `componentsDir` puts components beside the entry file.

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

## Options

```js
initAutoloader(import.meta.url, 'components', { extension: '.ts' });
```

**`extension`** defaults to `.js`, with or without the leading dot. Set `.ts` so a TypeScript dev
server can autoload sources directly — it will not serve `foo.js` when only `foo.ts` exists.

**`resolve(tag, dir)`** replaces URL building entirely, for a layout `dir/tag.ext` cannot express:

```js
initAutoloader(import.meta.url, 'components', {
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

## One attempt per URL

A URL is tried once per page load. A component that 404s logs once and is not retried until reload —
without that, a missing file cost a network request and a console line on *every* render, and the
same tag reached through two directories raced to define itself twice.

## What it does not do

Discovery does not descend into a child component's shadow root — that child marks itself
`autoloader` if it hosts lazily-loaded elements of its own. There is no preloading, no retry, and no
loading-state hook; a component that has not arrived yet is simply an un-upgraded element, which is
what `:not(:defined)` in your CSS is for.

## License

MIT
