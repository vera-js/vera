# @vera-hooks/typeahead

`createTypeahead()`: type to jump, as the APG prescribes for a listbox or a menu. Private until launch.

Printable characters accumulate for half a second (the native `<select>`'s window). Each one moves the highlight to the
next enabled row whose label starts with the buffer, wrapping. One letter pressed again cycles that letter's matches
instead of searching for a doubled prefix; a real prefix (`ch`) narrows without moving off a row that still matches.
`warm(now)` says whether the user is mid-word, when Space is a character ("New York") rather than an action.

It is pure: a buffer, the caller's clock and the caller's rows, with no store and no DOM. One instance serves every key
path of one control, so a word typed across a focus move stays one word.

```js
import { createTypeahead } from '@vera-hooks/typeahead';

const typeahead = createTypeahead();
const rows = [{ label: 'Apple' }, { label: 'Cherry' }, { label: 'Chestnut', disabled: true }];
const next = typeahead.type('c', performance.now(), rows, 0); // 1: Cherry
```
