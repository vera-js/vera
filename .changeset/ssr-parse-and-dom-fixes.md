---
'@verajs/ssr': patch
---

The server's markup scan and its DOM now agree with the engines in more places.

- **Case folds are ASCII-only**, as HTML's are: a `<textarea>` or `<style>` after `İ` ends at its own end tag, and a
  tag or attribute name holding a Kelvin sign or `ß` keeps it.
- **`getElementById` compares the id** rather than building a selector from it, so an id holding `"` or `\` is found,
  and an ancestor's query sees markup a child's `innerHTML` assigned. A query never enters a `<template>`'s content.
- **Attribute selectors** match HTML's case-insensitive attribute values (`lang`, `type`, …) without an `i` flag, on
  HTML elements only, and decode CSS escapes in the name and value. A query over markup the server DOM declined to
  parse warns (`ssr-markup-declined`).
- **`labels`** is defined on the labelable elements only.
- **What a template or value leaves open is closed where it opened**: a `<table>`, an `<object>`, an SVG or MathML CDATA
  section, and a text-only or raw-text element inside `<noscript>` or `<select>`. A `<plaintext>` is refused
  (`ssr-plaintext`).
- **The namespace is followed further**: a child template starts in its parent's namespace; a CDATA section is read as
  one only where the namespace says so, and one that could be read either way must end at the same place both ways
  (`ssr-cdata-unknown`); after an end tag at an integration point that may close a foreign element, the namespace is
  treated as unknown; a `<title>`, `<textarea>` or other text element opened in `<select>` or `<noscript>` markup, or
  where the namespace is unknown, ends only at its own end tag. Where the server cannot know how the browser parses, a
  value is escaped.
- **A `@verajs/lite` component whose style holds text that only looks like an end tag** (`</stylex>`) is served on the
  server, the same bytes core writes, where it was refused (`tier-hole-position`).
- **Faster server DOM**: `getElementById` parses only markup that can hold the id (a lookup that misses no longer
  parses the page), and a node no longer runs `EventTarget`'s constructor, which the server DOM's own listeners never
  used: parsing a 50 KB `innerHTML` takes about a quarter less time. One call changes: `EventTarget.prototype` methods
  called explicitly on a node (`EventTarget.prototype.addEventListener.call(node, …)`) throw; the node's own methods
  are unchanged.
- **An unknown `renderToString` option is refused** (`ssr-option-unknown`), naming it and the options there are.
