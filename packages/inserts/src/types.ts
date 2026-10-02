/**
 * Core's reactivity, handed to a `'store'` insert so a module can build a handler of its own on it.
 */
export type StoreKit = {
  /** Subscribes the running hook, if any, to `obj[key]` — any key, an object included. */
  track: (obj: object, key: unknown) => void;
  /** Wakes every hook subscribed to `obj[key]`, handing it the new and previous value. */
  trigger: (obj: object, key: unknown, value: unknown, prevValue: unknown) => void;
  /**
   * The channel a container's shape is published on: enumeration subscribes to it, and adding or
   * removing a key notifies it. A module tracks and notifies it for its own containers (a `Map`'s
   * iteration and `size`), through this name rather than a literal of its own.
   */
  shape: string;
};

/**
 * **Decides how a TYPE of value is reactive in every store** — `'object'`, `'array'`, `'map'`, `'set'`,
 * `'date'` … (the name `Object.prototype.toString` gives it, lower-cased).
 *
 * Handed the type, the handler chosen so far — core's own for `'object'` and `'array'`, `undefined` for a
 * type core leaves alone — and core's {@link StoreKit}. Return a handler to use instead, or nothing to
 * leave the choice as it is. Inserts run in priority order, each seeing the previous choice, so they
 * compose:
 *
 * - **claim a type core leaves alone** — `@verajs/store/collections` returns a handler for `'map'`,
 *   `'set'`, `'weakmap'` and `'weakset'`, built on `kit.track`/`kit.trigger`;
 * - **wrap core's handler** — `{ ...handler, set(obj, prop, value, receiver) { … } }` — for batching,
 *   transactions, undo, persistence or devtools; writing through `Reflect.set` on the raw target
 *   notifies nobody, and `kit.trigger` notifies later, which is how a module holds changes back. A
 *   decision about one particular object belongs inside the trap, which is handed the object.
 *
 * Consulted once per type — never per store, read or write — so a module that wires nothing costs
 * nothing and one that wires something costs only what its handler does. **A module wired late reaches
 * every store**: `wire` rebuilds each type's handler in place, and every proxy of that type shares it.
 * A module that throws throws from `wire`, and nothing changes.
 */
export type StoreInsert = (
  type: string,
  handler: ProxyHandler<object> | undefined,
  kit: StoreKit
) => ProxyHandler<object> | undefined | void;

/**
 * The renderer chain: what `render()` calls to put a template on screen. Core ships none, so an app
 * with no renderer wired warns in development and displays nothing.
 *
 * `any` rather than `unknown` throughout, and this is the reason (CODE-PRINCIPLES §1.8 wants it
 * stated): the template argument is whatever the WIRED renderer's tag produced, a type this
 * package cannot name without depending on every renderer that might be wired — which is exactly
 * the dependency the insert system exists to avoid. `unknown` does not work in its place, because
 * every renderer would then have to cast its own template type back out at its entry point. The
 * looseness is confined to this one signature; each renderer's own surface is fully typed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RendererInsert = (template: any, container: HTMLElement, ...args: any[]) => any;

/**
 * Runs when a hook callback or an element ref (`&ref`) throws. Neither error escapes — one failing
 * effect must not stop the others on the same element, and one failing ref must not stop the render
 * — so this is where a module decides what to do with it: an error boundary, a fallback render, a
 * report to an error tracker. `element` is the component being rendered, for a ref as for a hook.
 *
 * With nothing registered the error goes to `reportError`, which fires the window's `error` event
 * without unwinding, so page-error listeners and test runners see it; off-browser, to the console.
 */
export type ErrorInsert = (error: unknown, element?: HTMLElement) => void;

/**
 * Runs when `init()` sets an element up — after its shadow root exists, before its first render.
 * The extension point for anything that needs to see every component as it comes to life:
 * `static styles` adoption (`@verajs/styles`), instrumentation, per-element registration.
 *
 * Core dispatches it and knows nothing about what is registered. With nothing registered it is one
 * `Map.get` returning `undefined`, once per element.
 */
export type InitInsert = (element: HTMLElement) => void;

/**
 * Claims a value at a **child position** — `<div>${value}</div>` — by inspecting it.
 *
 * The point of this one is types you do not own. `_$child$` requires a property on the value, which
 * is fine for `keyed()` or a directive you wrote and impossible for a `Promise`, an `Observable` or a
 * `Temporal.PlainDate`. Return `true` to say the value is handled and stop the chain.
 *
 * Declared here rather than structurally in the renderer so `wire([renderer])` typechecks for a
 * consumer: a descriptor's `connect` receives the whole `Inserts` map, and a narrower parameter is
 * not assignable to that.
 */
export type ValueInsert = (part: object, value: unknown) => boolean | void;

/**
 * **The server half of light-DOM slots** — `@verajs/renderer/slots` registers it, `@verajs/ssr` reads
 * `_$server$` off the function and calls it with a host and its light children, once the host's render
 * is final (`@verajs/ssr` declares that member, in the types of its own DOM). On the client the slots module claims each `<slot>` through `'element'` instead, so the
 * function itself is never called there and declines (`null`). A hand-off between those two packages,
 * one module distributing on both sides; not a point to register a strategy on.
 *
 * Declared here rather than structurally for the same reason `ValueInsert` is: without it
 * `wire([renderer, slots])` does not typecheck for a consumer, because a descriptor's `on` is
 * `keyof InsertFunctionMap` and `'slot'` was not one of them.
 */
export type SlotInsert = () => null;

/**
 * **Claims elements in templates** — `@verajs/renderer/elements`. Asked about each element of a
 * template ONCE, as the template is first used, with the template's own inert element: its tag and
 * static attributes are real, bindings are not applied yet. Returns a shared behavior for an element it
 * wants, `undefined` for the rest. Every instance of the template then runs `create` as it is created,
 * before its first update writes anything into the element, `mount` after that update and `unmount`
 * at teardown with what `mount` returned.
 *
 * Declared here, structurally, for the same reason `SlotInsert` is — so `wire([renderer, elements,
 * claim])` typechecks without the renderer importing this package. The renderer's `ElementBehavior`
 * is the same shape, documented there.
 */
export type ElementInsert = (element: Element) =>
  | {
      create?(element: Element, adopted: boolean): void;
      mount?(element: Element, context: { root: Node | null; adopted: boolean }): unknown;
      unmount?(kept: unknown, element: Element): void;
    }
  | undefined;

/**
 * Resolves a DIRECTIVE NAME nobody has wired to a module that provides it — the seam
 * `@verajs/directives` asks (through the substrate stamp) before rejecting an unknown
 * `data-vd-*` name, and `@verajs/autoloader`'s `directiveLoader` answers by convention
 * (`{base}/{name}.js`). First claimer wins: return the `import()` promise (or any truthy) to
 * claim, `false`/`undefined` to decline. A claimed module REGISTERS ITSELF by importing
 * `wireDirectives` from the same specifier the page used — module caching makes that the same
 * registry, the exact symmetry of an autoloaded component calling `customElements.define`.
 * The asker re-checks its registry when the promise settles; loading is memoized by the
 * answerer, refusal by the asker.
 */
export type LoaderInsert = (name: string, element: Element) => boolean | Promise<unknown> | void;

/**
 * Runs during a SERVER render, once a component's tree is FINAL — its lifecycle has run, its
 * frames are drained, and the markup is about to be serialized. The last honest moment to write
 * to a server-rendered tree, and the only one that exists: a server has no observer and no second
 * pass, so `'init'` (which fires before the first render) is too early for anything that reads
 * rendered content.
 *
 * `@verajs/directives` is the first consumer — it evaluates declarative directives into the
 * markup here, so reflections are correct before any JavaScript reaches the browser. Anything
 * that needs to transform a finished server tree belongs here too.
 */
export type SettleInsert = (element: HTMLElement) => void;

/**
 * Called once as the renderer BUILDS each template — the cold path, cached for the life of the page.
 * A hook may set `_$at$` on the template: a resolver the renderer asks, once per instance created,
 * which template to build at a position given that position's parent node — `null`/an element, or
 * a detached fragment answered through `readScope`. `@verajs/renderer/namespaces` is the first
 * consumer: it parses an `html` template in the namespace of the position it lands in. It may also set
 * `_$inst$`, an instance hook — `@verajs/renderer/elements` asks its claimants about `root` here, once.
 *
 * `template` is the renderer's own object, exposed only through `_$…$` members (mangling exempts
 * them, which is what lets a separately built module reach it).
 */
export type TemplateInsert = (
  template: object,
  result: { _$litType$?: number; strings: TemplateStringsArray },
  readScope: () => unknown,
  /**
   * The template's CANONICAL content — its one root element, or its fragment — inert, with static attributes only
   * (bindings are never applied to it). **Read-only**: every instance is cloned from it, but a hydrated instance is not
   * (the server made its nodes), so a change here would reach some instances and not others. An svg/mathml variant a
   * module builds is its own template, and is handed its own root.
   */
  root: Node
) => void;

/**
 * Every extension point in the framework, and the signature each one's chain must satisfy. This map
 * is the whole contract: adding a point means adding a line here, and `wire` will then accept it.
 */
export type InsertFunctionMap = {
  'store': StoreInsert;
  'render': RendererInsert;
  'error': ErrorInsert;
  'init': InitInsert;
  'value': ValueInsert;
  'slot': SlotInsert;
  'template': TemplateInsert;
  'element': ElementInsert;
  'loader': LoaderInsert;
  'settle': SettleInsert;
};

/**
 * The registry itself — one `Map` from point name to its chain, held by core and handed to any
 * module that asks for it.
 *
 * There is exactly one per app, and that is load-bearing rather than incidental: production bundles
 * inline their dependencies, so a module that imported `@verajs/inserts` and built its own registry
 * would write to a map core never reads — working in development and silently doing nothing in
 * production. Modules take `wire` from `@verajs/core` for this reason.
 */
export type Inserts = Map<
  keyof InsertFunctionMap,
  (
    | StoreInsert
    | RendererInsert
    | ErrorInsert
    | InitInsert
    | ValueInsert
    | SlotInsert
    | TemplateInsert
    | ElementInsert
    | LoaderInsert
    | SettleInsert
  )[]
>;

/**
 * Everything an app can hand to {@link wire}: a **descriptor** naming the chain it belongs
 * in, or a **connector** — a function handed the registry, which is how a package that imports
 * nothing gets wired to it.
 */
export type InsertDescriptor = {
  on: keyof InsertFunctionMap;
  fn: InsertFunctionMap[keyof InsertFunctionMap];
  priority: number;
  /** For the collision message below. A package should set it; an inline descriptor need not. */
  name?: string;
  /**
   * Called with the registry as the descriptor is wired, for a package that also needs to *read* a
   * chain. `@verajs/renderer` uses it: the same entry that registers it as the renderer hands it
   * the registry it reads `'value'` handlers from, so an app writes one thing, not two.
   */
  connect?: (registry: Inserts) => void;
};
/**
 * A function handed the registry instead of a chain entry — how a package that registers nothing
 * still gets a reference to the map core reads. It is told apart from a descriptor structurally:
 * a function whose `on` is `undefined` is a connector.
 */
export type Connector = (registry: Inserts) => void;

/** Either form {@link wire} accepts, so a module can ship as whichever one suits it. */
export type Registerable = InsertDescriptor | Connector;
/**
 * Everything {@link wire} takes: one registerable, or an array of them — nested, so a module made
 * of several descriptors is itself an array and sits in an app's list like any other module.
 */
export type Wireable = Registerable | readonly Wireable[];
