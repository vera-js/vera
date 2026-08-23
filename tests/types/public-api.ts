/**
 * Type-level regression tests for the public API surface.
 *
 * These never run. They fail at `tsc` time, which is the point: the shape a consumer sees is part
 * of the contract, and nothing else in the suite checks it. `tests/*.test.mjs` runs against built
 * JavaScript and so is blind to the `.d.ts` layer entirely.
 *
 * Written against the `paths` aliases in the root tsconfig, so they check each package's `src` — the
 * source of truth — rather than a possibly stale `dist`.
 */
import { ref, shallowRef, createStore, untrack, deps } from '@verajs/core';

/** Fails to compile unless A and B are the same type, including union arity. */
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

/* ── ref ─────────────────────────────────────────────────────────────────────────────────────────
 * Regression: `ref` used to return `{ value: T } | { value: { value: T } }`. The union leaked out of
 * `createProxy`, whose handler is typed `ProxyHandler<T | { value: T }>` to cover the wrap it does
 * for a non-proxyable target — `new Proxy` infers its parameter from the handler too, so the union
 * became the return type. Consumers got `T | { value: T }` for `.value`, which made both
 * `count.value++` and a plain assignment a type error at every call site.
 */
type _refIsNotAUnion = Expect<Equal<ReturnType<typeof ref<number>>, { value: number }>>;
type _refCarriesItsType = Expect<Equal<ReturnType<typeof ref<string>>['value'], string>>;
type _shallowRefShape = Expect<Equal<ReturnType<typeof shallowRef<number>>, { value: number; _ignore: boolean }>>;

const count = ref(0);
count.value++;
count.value += 1;
count.value = 5;

const label = shallowRef('hello');
label.value = 'goodbye';

/* ── createStore ─────────────────────────────────────────────────────────────────────────────── */
const store = createStore({ name: 'vera', nested: { count: 0 }, items: new Set<string>() });
type _storeKeepsPropertyTypes = Expect<Equal<typeof store.name, string>>;
type _storeKeepsNestedTypes = Expect<Equal<typeof store.nested.count, number>>;
store.name = 'verajs';
store.nested.count++;
store.items.add('one');

/** `_delete` is optional on `Store`, so a consumer must reach it optionally. */
type _deleteIsOptional = Expect<Equal<typeof store._delete, (() => void) | undefined>>;
store._delete?.();

/* ── untrack / deps ──────────────────────────────────────────────────────────────────────────── */
type _untrackPreservesReturn = Expect<Equal<ReturnType<typeof untrack<number>>, number>>;
untrack(() => store.name);
deps(() => [store.name]);

/** Keeps `noUnusedLocals` quiet without weakening the assertions above. */
export type { _refIsNotAUnion, _refCarriesItsType, _shallowRefShape, _storeKeepsPropertyTypes };
export type { _storeKeepsNestedTypes, _deleteIsOptional, _untrackPreservesReturn };
