---
'@verajs/ssr': patch
---

The marker the server puts on a component a parent builds and hands properties to (until it renders) is no longer
visible to code reading the DOM: `getAttributeNames()`, `attributes`, `hasAttributes()`, `innerHTML` and `outerHTML`
answer as a browser's element does. A component that wrote what it read (a show-source or debug component) served the
marker's name in the page.
This holds for a node or markup kept past the render that marked it, too: a deep clone, a child appended and removed,
or a light component whose children were rendered with a property binding, kept in a module cache and read in a later
render.
