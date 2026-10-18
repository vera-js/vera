---
'@verajs/renderer': patch
---

A light-DOM `<slot>` removed by hand now unassigns its content, as in a shadow root

**Behavior:** removing a `<slot>` by hand (its `remove()` or `replaceWith()`, or removing its parent or an ancestor)
used to leave its content shown, because a slot with content has stepped out of the page. Its content is now
unassigned, as a shadow root does it: it shows in the next slot of that name in tree order, or nowhere. A removal of
the slot's parent or an ancestor is followed a microtask later, the rule for any hand edit to a light host; the slots
API reads it at once. One spelling still cannot work: `slot.parentNode.removeChild(slot)` on a slot that shows content
finds no parent, so use `slot.remove()`.
