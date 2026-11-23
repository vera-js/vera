---
'@verajs/ssr': patch
---

The marker the server puts on a component a parent builds and hands properties to (until it renders) is no longer
visible to code reading the DOM: `getAttributeNames()`, `attributes`, `hasAttributes()`, `innerHTML` and `outerHTML`
answer as a browser's element does. A component that wrote what it read (a show-source or debug component) served the
marker's name in the page.
