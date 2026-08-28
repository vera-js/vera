import { createHook, createStore } from '@verajs/core';

/**
 * A memoised derived value.
 *
 * ```js
 * const total = computed(() => cart.items.reduce((n, i) => n + i.price, 0));
 * render(() => html`<p>${total.value}</p>`);
 * ```
 *
 * The distinction that matters is against a plain function. `() => a + b` runs on every read;
 * `computed(() => a + b)` runs once per *change*, and only when something it actually read moves.
 * Reading it a hundred times in one render costs one evaluation, and an unrelated store write costs
 * none at all. That is the whole reason the primitive exists, and it is what the ten-line
 * `'proxy-handler'` recipe in the docs never provided — that one re-invoked the function on every
 * read, which is a getter with extra steps.
 *
 * **It is a store, so reading `.value` subscribes.** A component that reads a computed re-renders
 * when the computed changes, and computeds chain: one may read another and the invalidation
 * propagates. Shape matches `ref()` deliberately — both are `.value`, so they are interchangeable
 * at a call site.
 *
 * **Nothing was added to core for this.** It is built on `createStore` and `createHook` through
 * their public API, which is the module system doing its job: `@verajs/core` grew two bytes, for
 * returning a function it already constructed.
 */
export const computed = <T>(evaluate: () => T) => {
  /**
   * **Refused by name, like every other public function here.** `computed(undefined)` — the shape a
   * mistyped argument or a missing import produces — was accepted and failed later at the first read
   * with `evaluate is not a function`, which names a local variable inside this file and neither the
   * API that was called wrong nor what to pass instead. Every other exported function in this
   * framework says which one it was and what it wanted; a sweep calling all of them with wrong-typed
   * input found this one alone.
   *
   * `__DEV__`-only, as diagnostics here are: production is a browser the author has already run.
   */
  if (__DEV__ && typeof evaluate !== 'function')
    throw new TypeError(
      `computed: expected a function to derive the value from, and received ${
        evaluate === null ? 'null' : typeof evaluate
      }. Pass the expression as a function — computed(() => a + b), not computed(a + b).`
    );
  /**
   * A plain object as the hook's owner, never a DOM element.
   *
   * `runCallbacks` skips an owner whose `isConnected` is `false`, which is how a removed component
   * stops receiving updates. A plain object's is `undefined`, so it is never skipped and the
   * computed keeps working wherever it was created — including at module scope, where there is no
   * element to belong to.
   *
   * Its lifetime is the returned store's: `owners` holds the only strong reference, and the
   * tracking machinery keeps a `WeakRef`. Drop the computed and the owner, its hook and its
   * subscriptions all become garbage together. A computed created inside a component is therefore
   * collected with that component, without needing to know anything about it.
   *
   * The cast is the one place this reaches past the declared types. `createHook` says it wants a
   * component, because that is what it wants nine times out of ten — but it only ever stores the
   * hook on the owner, holds a `WeakRef` to it, and checks `isConnected`. Widening the declared
   * type to admit this was tried and rippled through `ComponentHook`, `reportHookError` and
   * `currentInstance` for no runtime difference, so the honest, contained version is one cast with
   * the reasoning next to it.
   */
  const owner = {} as Parameters<typeof createHook>[0]['element'] & object;
  const box = createStore({ value: undefined as T });
  owners.set(box, owner);

  /**
   * The evaluation happens *inside* the hook, which is what records the dependencies: tracking is
   * live only while `hooksQueue` holds this hook's entry, and that is only true within the wrapper
   * `createHook` returns. Running `evaluate()` outside it would produce the right value and
   * subscribe to nothing.
   */
  const run = createHook({ element: owner, priority: COMPUTED_PRIORITY, callback: () => {
    box.value = evaluate();
  } });

  /** The first pass. A component gets one from `render()`; a standalone value has to ask. */
  run?.(undefined, true);

  return box as { readonly value: T };
};

/**
 * Below the 50 a renderer registers at, so a computed is already up to date by the time anything
 * renders from it — one pass, not two.
 */
const COMPUTED_PRIORITY = 10;

/** Keeps each computed's owner alive exactly as long as the computed itself. */
const owners = new WeakMap<object, object>();
