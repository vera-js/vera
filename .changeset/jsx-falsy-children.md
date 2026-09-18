---
'@verajs/jsx': patch
'@verajs/renderer': patch
---

A boolean child renders nothing in JSX, and is named in a template

`{items.length > 0 && <em/>}` is the most common JSX conditional, and when the test failed it put
the word "false" on the page. Each grammar now answers the way its own users expect.

**JSX drops it**, React's rule. The transform filters child expressions — element children and a
component's children alike — through a module-local helper, so the value reaching the renderer and
`@verajs/ssr` is `null`, which both already drop: no renderer change, no serializer change, and no
new import specifier. Only booleans, so `{0 && <x/>}` still renders `0` exactly as React does. A
module that compiles no JSX children carries none of it, and the helper steps aside if your module
already uses the name.

**A template keeps lit's behaviour exactly** — anything not nullish renders — and development now
names a boolean child at the binding, once per distinct value. That is the one value semantic on
which JSX and a hand-written template differ, so the warning is also what meets JSX-shaped code
pasted into a template. Production carries neither the check nor the message: the renderer bundle
is byte-identical.

Measured: the filter's cost is below the noise floor in all three engines.
