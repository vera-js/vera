# The directives showcase

Every directive this system ships — interaction, expressions, the motion pack and its
vocabulary — live on one routed page, with each demo displaying the exact markup that
built it (`<demo-block>` renders its children *and* prints them, so the code cannot drift
from the demo).

Buildless, on the **production** bundles — which also makes the page a live proof of
substrate adoption: components and directives share one store registry even though the
directives bundle carries its own baked copy of core.

```sh
npm run build
node examples/directives/serve.js   # → http://localhost:5178/examples/directives/
```
