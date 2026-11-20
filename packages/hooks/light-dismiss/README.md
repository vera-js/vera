# @vera-hooks/light-dismiss

Outside-press and Escape dismissal for a widget's open region, headless: no markup and no styles. Private until
launch.

```js
import { lightDismiss } from '@vera-hooks/light-dismiss';
```

- **`lightDismiss(element, onDismiss)`**: installed only while activated; recognizes the element's own subtree
  through `composedPath()` (correct across shadow boundaries); releases its document listeners on unmount through
  core's cleanup contract. It returns `{ activate, deactivate }`, both idempotent and cheap, so a widget calls them on
  every open and every close.

It imports nothing from `@verajs/core`: it reaches core only through the element's structural cleanup contract.
