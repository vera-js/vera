---
'@verajs/renderer': patch
---

Hydration no longer gives up on a template containing an HTML comment.

The adoption walk is `ELEMENT | TEXT`, and part indices are numbered by that same walker, so a
comment is structurally invisible to it — but the live DOM still has one. `html\`<p>a<!-- n -->b</p>\``
adopted as text/comment/text where the walk wanted one run of text, and a trailing comment left a
child the walk never asked for. Both read as a disagreement, so **every template containing a
comment lost hydration**: the server's markup discarded and re-rendered, for markup the client had
itself produced. Nothing failed — the page is correct either way, which is why it went unnoticed —
but the cost was the first paint the server render was paid for.

Comments are now outside the comparison in both directions, which is the symmetric reading of the
same invisibility: a comment renders nothing, so neither a missing one nor a stray one can change
what a reader sees.
