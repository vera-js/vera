---
'@verajs/ssr': patch
---

`requestAnimationFrame` on the server hands out real ids, so a cancel cancels only what it names

The server's `requestAnimationFrame` returned a callback's position in its queue, and the queue starts over every
time it drains. So a component that canceled its own frame after it had run deleted whichever callback now sat at
that position, often another component's; a callback canceling another of the same frame did not stop it; and ids
repeated. The ids are now the platform's (unique, never reused, a cancel of a finished or unknown id does nothing),
each frame runs the callbacks that were waiting when it began, and `cancelIdleCallback` and `cancelAnimationFrame`
each cancel only their own kind, as in a browser.
