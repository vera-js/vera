# @vera-components/input

`<vera-input>`: A text input in the user's own <input>: optional prefix and suffix, a clear button that keeps undo, a password reveal, a caps-lock hint and a loading mark, all options; the input stays the form participant. Private until launch.

<!-- recipe -->
```js
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import '@vera-components/input';

wire([renderer]);
document.body.innerHTML = '<vera-input></vera-input>';
```
