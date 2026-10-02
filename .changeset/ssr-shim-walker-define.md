---
'@verajs/ssr': patch
---

The server DOM's tree walker, `define`, `getElementsByName` and `document.head.appendChild` answer as a browser does

`document.createTreeWalker` now follows the DOM standard's own algorithms. It used to step above its root in
`parentNode`, stop `nextSibling` at the first filtered sibling instead of searching on, and never skip a subtree its
filter rejected. `customElements.define` now refuses a value that is not a constructor and a class already defined
under another name, as every browser does. `getElementsByName` compares the `name` attribute exactly, so a name with a
backslash is found. And `document.head.appendChild` hoists only a `<style>` into the render's styles: it hoisted any
node's markup, so an appended `<script>` shipped its source inside the stylesheet.
