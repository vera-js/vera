---
'@verajs/core': minor
'@verajs/renderer': minor
---

A component's shadow root belongs to its template: `foreignNodes: 'drop' | 'preserve'`

**Breaking:** a shadow component whose root is empty at its first render no longer carries the two marker comments
around its template. Its template owns the root: foreign nodes — nodes placed in it by anything other than the template
— are left alone by an ordinary re-render and cleared with the rest when the template changes (a different template,
text, a list, nothing). Development names the first one it clears. Creating a shadow component is cheaper for it.

To keep the old behavior, a component says `init({ host: this, shadow: 'open', foreignNodes: 'preserve' }, setup)`, or
an app sets it for every component with `wire([renderer({ foreignNodes: 'preserve' })])`. That default covers component
roots only: a container handed to `renderInto` directly (`document.body`, `#app`, a shadow root you render into
yourself) always keeps foreign nodes where they are. A shadow root that already holds something at its first render — a
server's declarative root, `@verajs/styles`' `<style>` fallback — keeps its markers, and light-DOM component roots are
unchanged. An invalid value is named in development and treated as `'drop'`.
