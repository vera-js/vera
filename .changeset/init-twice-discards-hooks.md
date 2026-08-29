---
'@verajs/core': patch
---

Say when a second `init()` discards the hooks registered before it

`init()` starts a fresh generation of hooks, and dropping the previous one is correct and
load-bearing: `connectedCallback` runs again every time an element is re-added — a router navigating
back, a list reordering, a conditional subtree returning — and a fresh generation is what stops
effects from doubling.

Called **twice in one setup** it is a mistake instead, and every hook registered between the two
calls was silently discarded. `init(); useEffect(fn); init(); render(...)` never ran `fn`, with no
error and no warning — an effect that looks registered and is not.

It now says so, names how many hooks were lost, and explains why they were. The reconnect path stays
silent, which is asserted alongside: a diagnostic that fired on every router navigation would be
worse than none.

`__DEV__`-only; production carries neither the check nor the message.
