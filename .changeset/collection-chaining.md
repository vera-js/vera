---
'@verajs/reactivity': patch
---

A chained `set` or `add` on a store's `Map` or `Set` now notifies for every link, and `forEach` hands
its callback the store's collection rather than the raw one.

`Map.prototype.set` and `Set.prototype.add` return the collection so they can be chained, and the
wrapper returned what the underlying method gave it — the **unproxied** collection. So the second and
third links of `tags.add(1).add(2).add(3)` ran past the proxy: the data was completely correct and
subscribers were told once.

The case that matters is a chain whose *first* link happens to change nothing — `add` of a value
already present, `set` of the value already there. Then there is no first notification either,
nothing else is pending, and the render never happens: the collection holds three items, the page
shows one, and nothing throws or logs.

`forEach` had the same escape by another door — its callback's third argument was the raw collection,
so a callback writing through it mutated past the proxy.

`@verajs/reactivity/collections` grows 38 B gzipped, effectively all of it the `forEach` receiver;
returning the receiver from `set` and `add` is free.
