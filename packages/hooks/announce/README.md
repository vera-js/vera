# @vera-hooks/announce

`announce` and `want`: what a screen reader hears when something changes that the user did not move focus to (a save,
a count, a load), through one live region per document. Private until launch.

```js
import { announce, want } from '@vera-hooks/announce';

announce(form, 'Saved');                                   // said once, politely
announce(form, 'Card declined', { politeness: 'assertive' }); // interrupts: only for errors that block the user
announce(field, `${left} characters left`, { key: 'count' });  // a key keeps the last of a burst

const loading = want(spinner, 'Loading', { done: 'Loaded' }); // said once after a short settle window,
loading.release();                                         //   unless released (a fast load says nothing)
```

- **One region per document.** The first announcement creates a visually hidden `<div aria-live>` on the document's
  `body` (a second, `assertive`, one only when asked) and keeps it for the document's life, so any number of
  components never stack regions. An iframe and a popped-out window each have their own. Two copies of this hook on
  one page share one region and one settle window (two regions would speak every announcement twice).
- **Every message is heard, in the order asked.** Each one is added to the region as its own node a moment after the
  call, after every message asked for before it (the first into a new region waits a little longer, and the rest wait
  behind it), and the region speaks only what is added (`aria-relevant="additions"`), so two different messages in one
  moment are both said, and the same text twice is said twice. A `key` collapses announcements within that moment to
  the last one (moved to the back, so it follows the others), and a keyed message replaces that key's earlier one, so
  a count ticking while typing keeps one node. A message is removed from the region a few seconds after it was added;
  a removal is not spoken.
- **Modals.** While a modal `<dialog>` is open everything outside it is inert, and a screen reader does not speak an
  inert region, so the hook speaks from a region inside the topmost open modal: the one holding focus (`showModal()`
  moves focus into the dialog it opens), else the last open one in the document. **Limit:** if focus has fallen to
  `body` (the focused element was removed) and an earlier-in-the-document dialog was opened last, the hook can pick the
  lower one.
- **`want(element, label, { done })`** says `label` once when its window (~150 ms) closes, if some connected element
  still wants it then. A label whose elements were all released, or have all left the document, is dropped. Many
  elements wanting one label in one window say it once.
- **A said label is one load until it ends**, whichever elements hold it: an element that wants it later joins
  silently, so a framework that replaces its spinner with a new element on every render says it once. The load ends a
  settle window after its last holder is released or has left the document (a replacement inside that grace is the
  same load), and `done`, if given, is said then; the first `done` given for a label wins. One holder still on the
  page keeps the label's load running, so a second load with the same label says nothing: give two loads two labels.
- **`release()` when the element leaves for good.** A holder gone from the document and not released at a window's
  close is read as an abandoned load: it ends (its done text) and a new element wanting the label is a new load, said
  again. Core components release from an effect's cleanup, which runs as the element is removed. **Limit:** under a
  scheduler that runs effects late (`frameBudget`, a long task), a replacement arriving more than a settle window
  after its predecessor left is a new load: the done text, then the label again.
- **Inside an `aria-busy="true"` owner** (any composed ancestor, read when the window closes) nothing is said: the
  owner speaks for what is busy inside it. `underBusy(element)` is that test, for a component that needs it too.
- **A page that empties `body`** (a router swap) gets its region back on the next announcement, still exactly one.
- **Says nothing, and throws nothing,** for an element whose document has no window, and **queues nothing in a hidden
  tab**: an announcement nobody is there to hear is stale by the time they return.
- **Writes text only** (`textContent`): a string is never markup.
- **The shared record:** the region and the settle window live on the document under `Symbol.for('vera.announce')`, a
  shape declared for life that only grows, so every copy of this hook reads every version of it.
