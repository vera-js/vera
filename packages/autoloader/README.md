# @verajs/autoloader

Lazy component loading by tag name (~0.6 KB gzip): the first time an undefined custom element
appears inside an `autoloader`-marked component, its module is fetched from a bounded URL and
defined. `extension: '.ts'` supports TypeScript dev servers.
