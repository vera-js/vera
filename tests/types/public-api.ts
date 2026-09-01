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
import type { ParseRouteParams, RouteParams, RouterMethods } from '@verajs/router';

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

/**
 * **An element ref is created empty**, which is how the renderer's README, `llms.txt` and every
 * example write it — `<input ${myRef}>` assigns the element to `.value`. The signature required an
 * initial value, so following that documentation in TypeScript did not compile: `ref<HTMLInputElement>()`
 * was *"Expected 1 arguments, but got 0"*, and the workaround nobody would arrive at from the docs
 * is `ref<HTMLInputElement | undefined>(undefined)`.
 *
 * Found by installing the packed tarballs into an empty project and writing the documented app —
 * the type layer had never been exercised from outside the workspace with an element ref.
 */
const box = ref<HTMLInputElement>();
type _emptyRefIsOptional = Expect<Equal<typeof box, { value: HTMLInputElement | undefined }>>;
box.value = document.createElement('input');
box.value = undefined;

const _emptyShallow = shallowRef<string>();
type _emptyShallowRef = Expect<Equal<typeof _emptyShallow, { value: string | undefined; _ignore: boolean }>>;

/** And the valued form keeps its narrow type, which is the whole reason there are two signatures. */
const _narrow = ref(0);
type _valuedRefStaysNarrow = Expect<Equal<typeof _narrow, { value: number }>>;

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
export type {
  _refIsNotAUnion,
  _refCarriesItsType,
  _shallowRefShape,
  _emptyRefIsOptional,
  _emptyShallowRef,
  _valuedRefStaysNarrow,
  _storeKeepsPropertyTypes,
};
export type { _storeKeepsNestedTypes, _deleteIsOptional, _untrackPreservesReturn };

/* ── typed route params ──────────────────────────────────────────────────────────────────────────
 * `addRoutes` reads each route's params off its own `path` literal, so a component gets
 * `params.id` typed and `params.nope` rejected with no annotation at the call site.
 *
 * This is the part of the router that only exists at type level, so it is the part the `.mjs`
 * suites cannot see at all. `TypedRouteAction` and `ParseRouteParams` shipped for several versions
 * as exported types that nothing referenced — and `TypedRouteAction` named `Route` where it meant
 * `RouteSnapshot`, so anyone who had reached for it would have got the wrong shape.
 */
type _plainParam = Expect<Equal<ParseRouteParams<'/users/:id'>, object & { id: string }>>;
type _twoParams = Expect<Equal<ParseRouteParams<'/o/:org/u/:user'>, object & { org: string } & object & { user: string }>>;
type _optionalParam = Expect<Equal<ParseRouteParams<'/u/:id/edit/:tab?'>, object & { id: string } & object & { tab?: string }>>;
type _wildcardIsSegments = Expect<Equal<ParseRouteParams<'/files/*rest'>, object & { rest: string[] }>>;
type _staticPathHasNoParams = Expect<Equal<ParseRouteParams<'/about'>, object>>;

/**
 * A `path` function is typed `string`, not a literal, so it falls back to the loose record. Without
 * that first branch it would land on `object` and reject every param access instead of allowing any.
 */
type _nonLiteralIsLoose = Expect<Equal<ParseRouteParams<string>, RouteParams>>;

declare const router: RouterMethods;

router.addRoutes([
  {
    path: '/users/:id',
    component: (params) => {
      const id: string = params.id;
      return id;
    },
  },
  {
    path: '/files/*rest',
    component: (params) => {
      const segments: string[] = params.rest;
      return segments;
    },
  },
  {
    path: '/u/:id/edit/:tab?',
    title: (params) => `${params.id}${params.tab ?? ''}`,
    beforeEnter: (params) => params.id !== 'root',
    component: (params) => params.tab,
  },
  /** A dynamic path keeps the loose shape rather than losing param access entirely. */
  { path: () => '/computed', component: (params) => params.whatever },
  /** Inference must survive a route that declares no callbacks at all. */
  { path: '/about', title: 'About' },
]);

/** And the same array must reject what the pattern does not describe. */
router.addRoutes([
  // @ts-expect-error `nope` is not a param of this route
  { path: '/users/:id', component: (params) => params.nope },
]);
router.addRoutes([
  // @ts-expect-error a wildcard yields segments, not a single string
  { path: '/files/*rest', component: (params) => { const one: string = params.rest; return one; } },
]);

export type { _plainParam, _twoParams, _optionalParam, _wildcardIsSegments, _staticPathHasNoParams };
export type { _nonLiteralIsLoose };
