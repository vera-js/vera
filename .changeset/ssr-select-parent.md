---
'@verajs/ssr': patch
---

A selector's `>` and descendant combinators stop at a shadow root, as the browser's do

The server DOM's `querySelector`, `querySelectorAll` and `matches` walked a combinator onto the shadow root or
document fragment above an element and tested it as an element. So `root.querySelectorAll('* > i')` found a shadow
root's own top-level children (the root passed `*`), `element.matches('* > i')` said yes for one, and `.a b` or
`.a > p` queried from a shadow root threw a `TypeError`. A browser walks element parents only, and finds nothing
there. Now so does the server, and so `:scope` queried from a shadow root or a fragment matches no element, as
Chromium, Firefox and WebKit all answer (it found the root's children). `closest()` was already right.
