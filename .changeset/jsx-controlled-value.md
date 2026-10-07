---
'@verajs/jsx': minor
'@verajs/renderer': minor
---

JSX `value` and `checked` are controlled: compared with the control's live state

`value={x}` compiled to `.value`, which compares with the last value rendered — so a value reset before the next render
(typing, then a submit handler setting it back to `''` within one frame) rendered `''` twice, wrote nothing, and left the
user's text in the box. `value`/`checked` now compile to `!value`/`!checked`, which write whenever the control
disagrees, as React's controlled inputs do; `@verajs/renderer/tag`'s runtime name table (a tag used as a JSX component)
maps them the same. An explicit `.value={…}` is unchanged.

**Breaking for one pattern:** as with React, a bound `value` the component never updates on input is now restored by the
next render — `<input value={initial}>` with no input handler used to keep what was typed. The compiler now says so, once,
with the file and position: a new `onWarning` option of `transformJsx` hears it, the Vite plugin reports it through Vite,
and the buildless loader prints it in development. Use `defaultValue` for an initial value, `readOnly` for a fixed one,
or keep the value in step with `onInput`/`onChange`.
