---
'@verajs/renderer': patch
---

Light-DOM slots: on a component observed with `observeSlots: 'eager'`, a `<slot>` inserted by hand now takes part, as
in a shadow root. It is claimed like the template's own and takes the assignment by tree order, and removing it again
hands its content back. A `<slot>` inside the component's light content is light DOM and is left alone. Components
observed lazily (the default) don't follow hand-inserted slots and pay nothing for it; render slots conditionally
from the template there.
