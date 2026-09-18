---
'@verajs/renderer': patch
---

`spread()` accepts a props type declared as an `interface`

`spread()` was typed `Record<string, unknown>`, which a TypeScript **interface** does not satisfy —
a type alias carries an implicit index signature and an interface does not. So a user who declared
their props the way the TypeScript handbook teaches got `TS2345: Index signature for type 'string'
is missing in type 'CardProps'`, while the sibling `props()` accepted the identical value because
it is generic. Two functions in one module disagreeing about the caller's own type is not something
people report as a bug; they stop using the one that refused them.

The parameter is now `object | null | undefined`. Nullish stays admissible deliberately: JSX
compiles `{...maybe}` straight to a call here, and the runtime already answers a bad bag with a
development warning rather than a throw, so narrowing the type would move that failure to compile
time for a pattern the runtime tolerates on purpose.

Type-only — the bundle is byte-identical, and every call that compiled before still does.
