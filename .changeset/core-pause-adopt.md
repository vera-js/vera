---
'@verajs/core': patch
---

A paused component (`persist`, or an async setup still pending) taken into another window with `adoptNode` and
appended there stays alive: its pause timer was set on the new window and never cleared by the resume, so it fired
and tore down a component that was back in the page, whose writes then no longer rendered.
