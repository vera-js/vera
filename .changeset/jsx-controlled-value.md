---
'@verajs/jsx': patch
'@verajs/renderer': patch
---

JSX `value` and `checked` are controlled: compared with the control's live state

`value={x}` compiled to `.value`, which compares with the last value rendered — so a value reset before the next render
(typing, then a submit handler setting it back to `''` within one frame) rendered `''` twice, wrote nothing, and left the
user's text in the box. `value`/`checked` now compile to `!value`/`!checked`, which write whenever the control
disagrees, as React's controlled inputs do; `@verajs/renderer/tag`'s runtime name table (a tag used as a JSX component)
maps them the same. An explicit `.value={…}` is unchanged. As with React, a bound `value` the component never updates on
input is restored by the next render.
