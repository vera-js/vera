---
'@verajs/core': patch
---

`define()` — a component without writing a class

`define('tag', setup)` and `define({ tag, …options }, setup)` register the custom element and return its class. The
options are `init`'s, plus:

- `props: { name: default }` — declared props, for components other code drives: a plain write after connect repaints
  (an undeclared prop's does not). Defaults are lazy and copied per element for arrays and plain objects; types follow
  the defaults; a value set before the tag was defined wins.
- `attributes: ['label', 'data-count']` — observed attributes, each a `string | null` prop under its camel name; one
  way only; removal writes `null`. A tag that declares none carries no attribute callback.
- `methods: { open() {…} }` — public methods on the prototype; `this` is the element.

Development names the mistakes by code: a bad tag or setup, a second `define`, a default that cannot be copied, a
shared prop that would change type, an attribute or method shadowing the platform's.

Also: a component's props record is released when it is removed (class components included), so a removed element no
longer keeps its props store alive until the browser's cycle collector frees it.
