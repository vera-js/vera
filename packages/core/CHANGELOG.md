# @verajs/core

## 0.5.1

### Patch Changes

- 4bf8b98: An array's single write is one wake: a `'sync'` effect or a watched `computed` that read `length` and an index a
  truncating `length = n` drops, or an index and the list's walk, runs once per write instead of twice. Core's bundle
  is smaller by the array handler's write wrappers.
- 4bf8b98: A computed that reads itself, directly or through another, throws `computed-cycle` in development, read from plain
  code or by an effect, where it recursed until the stack overflowed or re-ran about 1200 times a write. Production is
  unchanged.
- 45a880c: With a scheduler that runs the flush at once, a hook's error reaches the `'error'` chain once. A handler that rethrew
  it used to hear it a second time, through the write that asked for the flush. It is now thrown as uncaught, as the
  default scheduler leaves it, and the write no longer throws.
- dd8245c: Three scheduler and store fixes:
  
  - An `'error'` handler that rethrows no longer strands the hooks queued behind the failing one: they are queued again
    and a flush is asked for, so they run (before, no later write could queue them, and a hook on an unrelated signal
    never ran again).
  - `setRenderScheduler` called from inside a flush with a scheduler that runs at once no longer stops rendering for good.
  - `Object.defineProperty` on a store array tells `length`'s readers when it moves `length`, and a shorter `length`
    tells the readers of the indices it drops, as an assignment does.
  - A store key made enumerable or hidden by `Object.defineProperty` tells the readers of the key set
    (`Object.keys`, `JSON.stringify`), as adding a key does.
- ec43d4c: A hook's error never leaves a write: an `'error'` handler that rethrows, under a `'sync'` effect or a scheduler that
  runs the flush at once, no longer stops the write before every later subscriber hears it. The error is reported as
  uncaught, as the default scheduler's flush reports it; `flush()` still throws it.
- bb0c5e3: A paused component (`persist`, or an async setup still pending) taken into another window with `adoptNode` and
  appended there stays alive: its pause timer was set on the new window and never cleared by the resume, so it fired
  and tore down a component that was back in the page, whose writes then no longer rendered.
- 3cb419e: Faster component creation and updates. A `define` element's props record starts out known as a plain data record, so
  its first write no longer scans every prop's descriptor.
- 4bf8b98: Development's render-loop warning names a hook owned by a plain object (a module's `effect`) without a tag, where it
  printed "on <undefined>".
- eaab014: A light component that renders no `<slot>` and reads its own children can say so: `static ownsChildren = true` on its
  class, or `define({ tag, ownsChildren: true })`. On a page that wires `@verajs/renderer/slots` for other components,
  slots then never moves that component's children into its unassigned carrier, at init or at a render's end, so the
  component still finds the children it reads. A component that declares it and renders a `<slot>` is told once in
  development (`owns-children-slot`). Nothing changes on a page without slots.
- cbf6b05: `@verajs/ssr/named-references`: every named character reference of the HTML Standard for the server DOM, as a module
  to wire (`wire([namedReferences])`). The server's parser decodes six names itself (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
  `&apos;`, `&nbsp;`) and every numeric reference; wired, every other name reads back as the text a browser gives in
  `textContent`, attributes, `.value` and a bound `<select>`'s options, by the tokenizer's rules: a legacy name without
  its `;` decodes too (`&amp` in text is `&`), the longest name wins (`&notin` in text is `¬in`), and in an attribute
  value a legacy name before `=` or a letter or digit stays as written (`&ampx=1`). A server that does not wire it never
  loads the table and reads such a name back as written, as before, and now says so once per name written with its `;`
  (`ssr-named-reference-unwired`). The served markup is unchanged. `'reference'` is the new insert point the module wires
  on (types only).
- Updated dependencies [cbf6b05]
  - @verajs/inserts@0.2.3

## 0.5.0

### Minor Changes

- 71b9d17: `isServer` is now a function, `isServer()`, read when it is called. As a constant computed when core loaded, it answered
  `false` for the whole process whenever core was imported before `@verajs/ssr`, so per-user state guarded by it was
  rendered into server markup. **Code written as `if (!isServer) …` must become `if (!isServer()) …`**: a function is
  always truthy, so the old spelling no longer throws, it silently takes the server branch everywhere, in the browser
  too. TypeScript (strict, 6.0.3) reports `if (isServer)`, `isServer ? … : …` and `isServer && …` as TS2774, but not
  `if (!isServer)`, the guard's usual spelling: search for `isServer` not followed by `(` (`grep -rnE 'isServer($|[^(])'`).
  `@verajs/lite` gains the same `isServer()`, so a component guarding per-user state runs unchanged on either tier.

### Patch Changes

- f6f470d: `define({ tag, formAssociated: true }, setup)` makes a form-associated custom element: the class gets the platform's
  `static formAssociated = true` before it is registered, so a form lists it and submits the value its internals set, and
  its form callbacks (given as `methods`) are called.
- deff2a3: `define({ tag, register: false }, setup)` builds the component class and returns it without registering it, so the
  caller decides when and under which name it is defined; `customElements.get(tag)` stays `undefined` until then.

## 0.4.2

### Patch Changes

- caed868: `isServer`, a boolean: `true` while `@verajs/ssr` renders, `false` in a browser. Guard per-user state with it
  (`if (!isServer) …`) rather than `typeof localStorage` or `typeof sessionStorage`: Node 26 gives every server process
  a working `sessionStorage`, shared by all its requests, so a `typeof` test passes on the server and could render one
  visitor's stored state into markup served to everyone. It reads a flag `@verajs/ssr` 0.3.3 sets, so it needs that
  version or later. 21 bytes gzipped.

## 0.4.1

### Patch Changes

- 5452bf5: A keyed list over a store array no longer prints the `lists-unwired` development warning
  
  The warning tells you that a store array's `.map` of templates is matched by position, and suggests wiring `lists` or
  using `keyed()`. It also fired when every row already used `keyed()`, including the JSX `key={id}` form, which compiles
  to `keyed()`, so it advised the fix you had already applied. Keyed rows are matched by key, so they no longer warn.
  Rendering was always correct; this changes the development warning only, and production is byte-for-byte unchanged.

## 0.4.0

### Minor Changes

- f896112: `computed` is core's, and `ref` / `shallowRef` became `signal` — shallow by default
  
  **Breaking.** Four changes to state, in one release:
  
  - **`computed` moved into core** (`import { computed } from '@verajs/core'`); `@verajs/store/computed` is removed. It is
    now **lazy and linked only while something reads it**: read by a render, an effect or another computed, it stays
    current inside the write that changes its source; read by nothing, it holds no subscription and evaluates when read
    (cached until the next store write); when its last reader goes, it lets go of its sources. A computed made anywhere —
    a setup, a render, an effect, module scope — never keeps anything alive past its last reader. It used to evaluate at
    creation and on every dependency write, read or not.
  - **`ref` was deep; `signal` is shallow by default — use `signal(v, { deep: true })` for the old behavior.** `ref(v)`
    and `shallowRef(v)` are removed: `shallowRef(v)` is `signal(v)`, and `ref(v)` holding an object is
    `signal(v, { deep: true })` (a primitive, or a value only ever replaced, needs no option). Replacing `.value` always
    notifies; with the default, mutating inside it does not — the semantics of every signals library and TC39's
    `Signal.State`. An element ref is `signal()`, as `ref()` was.
  - **A signal is a small object, not a Proxy: its `value` lives on a prototype every signal shares.** Reading `.value`
    subscribes and a write that is not `Object.is` the held value notifies (see the equality rule below). `JSON.stringify(signal)` writes the value it holds (`toJSON`);
    `Object.keys(signal)` is `[]` and a spread or `structuredClone` copies no `value`; `'value' in signal` is `true`. Only
    reading `.value` subscribes: `in`, `Object.keys` and `for…in` on a signal subscribe to nothing. Its tag is
    `[object Signal]`, so a store never wraps one written into it.
  
  **One equality rule for stores, signals and computeds: `Object.is`.** A write, a definition or a recomputation is a
  change when the new value is not `Object.is` the old one: `-0` written over `0` is stored and notified (it was dropped as
  no change), and `NaN` over `NaN` is no change (a signal, an array's walkers and a computed were notified). Every other
  value compares as `===`, at the same cost.
  
  `deep` takes effect only as `true`, in both builds; any other value is the default, and development names it
  (`deep-not-boolean`).
  
  **TypeScript:** `Signal` is now the type `signal()` returns (`{ value: T }`); the change payload a hook is handed —
  what `Signal<V>` used to name — is `Change<V>`. Code importing the old `Signal` type for a hook's argument switches to
  `Change`.
- dc329ac: `effect(fn, options)` is the one primitive for work that follows state; `portal(target, template)` draws into another element
  
  **Breaking.** Six exports leave `@verajs/core`, replaced by `effect`:
  
  | Before | Now |
  | --- | --- |
  | `useEffect(fn)` | `effect(fn)` |
  | `useLayoutEffect(fn)` | `effect(fn, { timing: 'layout' })` |
  | `useSyncEffect(fn)` | `effect(fn, { timing: 'sync' })` |
  | `useHook(fn, priority, element?)` | `effect(fn, { priority, owner: element })` |
  | `createHook({ callback, priority, element })` | `effect(fn, { priority, owner })`, started with `.run()` — scheduled, once per flush. Running INSIDE every write, unbatched, is no longer public; `computed` covers a derived value |
  | `useRender(template, element)` | return the render from the setup; to draw into another element, `portal` (below) |
  
  - **`effect` returns the effect itself**: `run()` runs it now, `stop()` ends it for good — its cleanup runs once, it
    leaves every store, and nothing runs it again.
  - **`owner`** makes an effect outside a setup — a module's own value, retired by whoever owns it. With no owner and no
    component being set up, it throws (`no-owner`), as the hooks did.
  - **`priority`** orders within a flush, lower first (50 is the render); a non-finite one registers nothing, and
    development says why (`priority-not-finite`).
  
  **`@verajs/renderer/portal`** (new): `portal(target, template)`, called in a setup, draws into `target` — a modal on
  `document.body` — in a range of its own (any number share a target), in the render's slot (keyed rows follow their
  items; layout effects see it drawn), and leaves with its component (a `persist`ing one takes it out while away and draws
  it again when back). It draws `target`'s light DOM, never a shadow root, and registers nothing on a server. It keeps
  `@verajs/core` external in every build, so the renderer now lists `@verajs/core` as an OPTIONAL peer dependency — only
  this entry needs it.
- 0c4ffac: A component moved by one DOM operation is no longer torn down and set up again — and core no longer touches custom elements that are not its own
  
  **Breaking for code that relied on a move re-running setup.** Moving a Vera component (one that ran `init()`) that
  is already in the page in ONE operation — `append` or `insertBefore`, which is how a keyed list reorders and how
  light-DOM slots place a slotted component — used to run its whole teardown and then its whole setup again:
  its effect cleanups, its `disconnectedCallback`, its `connectedCallback`, a second render, and a second fetch if it
  fetched in its setup. A Vera component moved by one DOM operation is no longer re-rendered or set up again: neither
  callback runs, its effects stay live, and its state is untouched. Core tells a move from a removal the way the platform
  lets it — a moved element is still connected when its `disconnectedCallback` runs. A removal (`remove()`, or a hop
  through a `DocumentFragment`) tears down exactly as before, synchronously, and a move into another document (a
  popped-out window) still tears down and sets up again, since its listeners and frame clock belong to the old window.
  
  **Fixed: core wrote to third-party custom elements.** Core wraps `customElements.define` to run effect cleanups on
  removal, and that wrapper sees every class defined after core loads. On every disconnect it set a field of its own on
  the element — in production a one-letter name (`t` in 0.3.1) — so a minified third-party component keeping a field of
  that name had it overwritten with `true` whenever it left the page. The wrapper now touches only elements `init()` has
  run on; any other custom element gets exactly its own callbacks, with nothing read from it or written to it.
  
  The wrapped `connectedCallback` also returns what the component's own returned, so a server render still awaits an
  `async connectedCallback`.
- da55d31: A hook, `render()` or `mount()` with no component being set up now throws (`no-owner`, in every build)
  
  **Breaks:** `async connectedCallback() { init(this); await load(); useEffect(…); render(…) }` — an `await` BETWEEN
  `init()` and a hook or `render()`. It worked for a component alone and now throws, in the browser and on the server
  (`renderToStringAsync`) alike. Three fixes, in the order the message gives them:
  
  1. Await **before** `init(this)`: `const data = await load(); init(this); …`
  2. Or set up first and write what arrives into state: `init(this); const state = createStore({ data: null });
     render(…); state.data = await load();`
  3. Or pass the element to a hook created later: `useEffect(fn, this)`.
  
  **Fixes:** setup used to stay open until a `render()`/`mount()` or the next component's `init()`, so the same code
  behaved three ways: alone it worked; overtaken by a component that had finished setup, its hooks were dropped
  silently; overtaken by one still mid-setup (another async component, initialized later), its hooks — and its render —
  attached to THAT component and ran against the wrong element, with no error. Setup now ends at the end of `init()`'s
  microtask turn, so a hook after an `await` fails the same way every time, naming the fixes. A hook or `render()` from
  a handler after setup, and a second `render()`, fail the same way (they did nothing before).
- 2912a97: A component is one setup that returns its render — `render()` and `mount()` are removed
  
  **Breaking.** `init` takes the component's setup as its second argument. The setup runs once, untracked, and returns
  the function that draws; that function is the only part that re-runs when state it read changes:
  
  ```js
  class ClickCounter extends HTMLElement {
    connectedCallback() {
      init({ host: this, shadow: 'open' }, () => {
        const state = createStore({ count: 0 });
        return () => html`<button @click=${() => state.count++}>Clicked ${state.count} times</button>`;
      });
    }
  }
  ```
  
  Migrating:
  
  - **`render(fn)` becomes `return fn`** from the setup: move everything between `init(this)` and `render(…)` into a
    function, `init(this, () => { …; return () => html`…`; })`. A template passed to `render` directly (not a function)
    was drawn once; return `() => view` for the same result.
  - **`mount()` goes.** A setup that returns nothing is a side-effect setup: its effects run and it draws nothing.
  - **The options travel with the host.** `init(this, { mode: 'open' })` becomes `init({ host: this, shadow: 'open' },
    setup)`; `shadow` is `'open'`, `'closed'`, `false` (light DOM) or a `ShadowRootInit`. An old call still runs — the
    object is ignored in every build, so it sets up with no shadow root — and development names the new spelling once
    (`init-options`); TypeScript refuses it at build time.
  - **Extra arguments to `render(template, …args)`** were forwarded to the renderer, which never read them. Capture
    anything the render needs in the setup instead. `useRender(template, element)` takes exactly two.
  - **`useRender` returns nothing (`void`)**, as its docs always said. Its TypeScript type had declared the hook it
    registered (`HookCallback | undefined`), and calling that ran a render pass by hand; a render re-runs when state it
    read changes, so write to that state instead.
  - **A class can keep a method.** `init(this)` with no setup calls `this.setup()`, so
    `connectedCallback() { init(this); }` plus `setup() { …; return () => html`…`; }` is the same component.
    `init({ host: this, shadow: 'open' })` does the same with a shadow root. Development names a near-miss
    spelling (`setUp`, `Setup`, `set_up`) once.
  - **An async setup is atomic.** Its hooks must be registered before its first `await` — one after it throws
    `no-owner`, as before. Nothing it registered runs until it resolves, a write while it is pending does not re-run
    it, and a rejection is reported once through the error chain and commits nothing.
  
  `renderer({ shadow })` sets the app's default root — `wire([renderer({ shadow: 'open' })])` — which a component's own
  `shadow` overrides. The same `wire` call works unchanged on the server, where `@verajs/ssr` keeps its own renderer
  and learns the default from it.
  
  A removed component now leaves nothing behind in a store it read: each hook unsubscribes exactly the keys it joined,
  with no sweep, and an element set up again in place runs its previous setup's effect cleanups first.
- 8317803: A component's shadow root belongs to its template: `foreignNodes: 'drop' | 'preserve'`
  
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
- b71541b: One queue, one flush: renders and effects run as a microtask
  
  **Breaking for timing.** Every queued render, layout effect and effect now runs in ONE flush — a microtask, as in Lit
  and Vue — instead of on the element's next animation frame. After any `await`, everything Vera has queued is done — the DOM
  and its effects are current, on every device; `flush()` drains at once without an `await`. A write reaches the DOM in about 1–5 ms instead of 19–24.
  
  - **Order:** renders, then layout effects, then effects — and parents before children, so a child re-rendered by its
    parent's new props renders once.
  - **`useLayoutEffect` now means what it means in React:** it runs right after the render, so it measures the DOM that
    render made, and a write it makes re-renders in the same flush, before paint. It used to run BEFORE the render and
    see the previous render's DOM — a measurement ported from React measured stale layout. A layout effect now also runs
    after `@verajs/directives` has applied an element's directives. A hook of your own made with `createHook` at a
    priority between 25 and 60 that relied on running after layout effects on the first pass now runs before them.
  - **`frameBudget`** (new, opt-in): for apps that receive bursts of data as many tasks in one frame — past about 4 ms
    of flush work in a frame, the next flush waits for the element window's frame (or a short timer where there are no
    frames), so a burst renders about once per frame (measured 2–4× faster to the final DOM). The trade: after `await`
    the DOM may still be on its way — `flush()` first. User input gains nothing; browsers already merge it.
  - **Loops:** a hook may run twice in one flush — so an effect that measures what was just rendered and stores it lands
    before paint — and a third run waits for the next frame. A self-feeding effect never freezes the page; development
    warns after 50 consecutive frames, naming the hook that writes. `allowRenderLoop(element)` silences it.
  - **`flush()`** runs everything queued, synchronously — replacing the swap-the-scheduler `flushSync` recipe. Inside a
    running flush (a hook, a render, an event one of them fired) it does nothing — the DOM updates when that flush ends —
    and development says so once (React's `flushSync` makes the same choice).
  - **`setRenderScheduler(fn)`** now decides when a FLUSH runs; `microtask` is the same timing without the budget.
  - **Effects run before paint**, after their flush's renders: a slow `useEffect` delays its own update's paint.
  - A window with no animation frames updates after a microtask, like every other, rather than synchronously.
  - **`useHook(callback, priority, element?)`** is new: a hook of your own, scheduled as the built-in ones are, at a
    priority you choose — `25` runs before the render and reads the DOM the last render left. `createHook` stays the
    raw primitive, which runs inside every write it hears, unbatched.
  
  `@verajs/ssr`: each round of the server's drains runs core's flush first, so both `renderToString` and
  `renderToStringAsync` serialize the same settled markup — a `useLayoutEffect`'s state now reaches the markup through
  both (it reached only the asynchronous one).

### Patch Changes

- da55d31: `useEffect(async () => …)` works: only a returned function is a cleanup
  
  An async callback returns a promise, and core took it as the cleanup — calling it on the next run and on removal
  printed `[vera] a hook threw:`. It now just runs (`useEffect`, `useLayoutEffect`, `useHook`), the type admits it, and
  development names an async callback once: it cannot clean up, and what it awaits can arrive late — write a plain
  effect that starts the work and returns a cleanup that cancels it.
- b1e8b6a: `effect()` throws at the call when given a non-function callback
  
  Previously `effect(undefined)` was accepted and failed later, at its first run, far from the line that caused it. It
  now throws a `TypeError` at the call, in development and production alike, coded `callback-not-function`: the usual
  cause is passing a function's result (`effect(fn())`) instead of the function, or a callback read from options that is
  undefined.
- 14c7a84: A component moved into another window — a `window.open` pop-out or an iframe — and back is kept
  
  Moving a component into another window's document with plain DOM no longer tears it down and sets it up again: its
  state survives the trip both ways. Its `useEffect` and `useLayoutEffect` run their cleanups and run again against the
  new window, and `@verajs/styles` applies its styles again (a move empties a shadow root's adopted stylesheets). Content
  rendered while it is out is built in its own window's realm, so child components created there work in every engine
  (Firefox and Safari left them inert). A built-in host set up through `@verajs/renderer/native-elements` behaves the
  same. Read the window inside an effect rather than in setup; remove and re-append a component to reset it.
- b8f7d30: `persist: seconds`, and an async setup is never run twice for one element
  
  A removed component can now be kept for a while: with `persist: seconds` (an `init` and `define` option), removal
  PAUSES it — every effect's cleanup runs, its state and DOM are kept — and re-adding it within that many seconds resumes
  it (every hook runs once, so a change it missed is drawn; its setup does not run again). Past the window it is torn
  down. The default, 0, keeps today's behavior.
  
  The same pause fixes a bug: a component removed and re-added while its **async setup** was still awaiting started a
  SECOND setup, and an effect the first one registered after its `await` then ran twice on every change. Now, removed
  while pending, a component waits up to 5 s: re-added in time, the in-flight setup carries on (one setup, one fetch);
  still out, it is torn down — and development says so.
- 0986593: `define()` — a component without writing a class
  
  `define('tag', setup)` and `define({ tag, …options }, setup)` register the custom element and return its class —
  the registered one, so `new` and `instanceof` work even after a development redefine. The
  options are `init`'s, plus:
  
  - `props: { name: default }` — declared props, for components other code drives: a plain write after connect repaints
    (an undeclared prop's does not). Defaults are lazy and copied per element for arrays and plain objects; types follow
    the defaults; a value set before the tag was defined wins.
  - `attributes: ['label', 'data-count']` — observed attributes, each a `string | null` prop under its camel name; one
    way only; removal writes `null`. A tag that declares none carries no attribute callback.
  - `methods: { open() {…} }` — public methods on the prototype; `this` is the element.
  
  Development names the mistakes by code: a bad tag or setup, a second `define`, a default that cannot be copied, a
  shared prop that would change type, an attribute or method shadowing the platform's.
  
  Also: a component's props record is released when it is removed (class components included), so a removed element no
  longer keeps its props store alive until the browser's cycle collector frees it.
- afbae92: Core's diagnostics return, and two behaviors are corrected
  
  The diagnostics the 0.3 rebuild set aside are back, each tied to a code with a docs entry. Development only (zero
  production bytes) unless noted:
  
  - **No renderer wired** is said once per page **in every build** — a CDN page never runs a development build.
  - A self-feeding `useSyncEffect` is stopped and named at depth 50; `html`/`svg`/`mathml` called with a string,
    `untrack`/`setRenderScheduler` given a non-function, `init`/`allowRenderLoop` given a non-element are named; a write a
    store's source object refuses (frozen, sealed, non-writable, getter-only) names the rule instead of the engine's
    trap message; a `Map`/`Set` in a store with nothing to make it reactive is said once; a bound property meeting a
    getter-only member is refused and said once; a setup that registered hooks but was never committed, and a second
    `init()` in one setup, are said; markup addressed to an unwired directives engine is said. A component declaring `static styles` with `@verajs/styles` not wired is said
    once per page — the check asks for styles itself, so wiring another `'init'` module no longer silences it.
  - A bare `render()` (no template) commits the setup without registering a render — it no longer draws `undefined`
    over the root — and development names `mount()`.
  - **A cleanup that throws now reaches the app's `'error'` chain**, like a hook that throws, attributed to its
    component — apps with a chain wired will now see cleanup errors they did not before. With no chain it is reported
    the platform's way, beside its code (`cleanup-threw`) where the console prints it.
  - `init` and `allowRenderLoop` accept an element from another window (a popped-out window's component failed the
    opener's `instanceof Element`).
  - Each copy of core tears down only the components it initialized: a page holding two copies (a bundle that inlines
    core) threw on removing a component, as one copy read fields the other never set.
- 8854735: Hooks run in exact priority order, and a non-finite priority is refused the same way in both builds — development says why
  
  **Fixes:** hooks were ordered by one number, `priority × 1e9 + a page-wide creation count`. Close fractional priorities
  could run in the wrong order (`50.000001` after `50.000002` once enough hooks were created between them), priorities
  above about 9 million collided, and on a page that had created a billion hooks a priority-50 hook was read as 51 — it
  ran after priority-51 hooks and a property arriving late no longer re-rendered it. Priority and creation order are now
  compared separately: any finite priority runs in exact order, then creation order within it.
  
  **A priority that is not a finite number** (`NaN` — what `parseInt` of a missing config value gives — `Infinity`,
  `-Infinity`): `useHook` and `createHook` register nothing and return `undefined`, in both builds, as before; development
  now also prints `[vera] … (priority-not-finite)` naming the call, where it used to say nothing. `wire` follows the same
  rule: it used to throw in development only and, in production, wire the entry and misbehave; it now refuses in both
  builds — nothing is wired — and development prints `(wire-priority)`. **In production the refusal is SILENT** (no
  message is shipped): an effect with a bad priority simply never runs, so check development's console.
- aab427a: Creating and removing light-DOM components is up to 6% faster: core marks its own components with a field, not a WeakSet
  
  **Performance:** core recorded every component it initialized in a WeakSet keyed by the element, and its
  `customElements.define` wrapper asked that set on every connect and disconnect. A weak collection keyed by DOM nodes
  costs both engines' garbage collectors for every entry, so the mark is now a field on the element under a `Symbol`
  private to each copy of core — two copies of core on one page still each know only their own components. Measured on
  light-DOM components with a fresh browser per page: creation 5–6% faster in Chrome and Firefox, churn 5% faster in
  Chrome and even in Firefox.
- c300bb3: A module can own a key on a component's options: core hands `init({ host, … })`'s object to every `'init'` hook, and `wire` hands a connector itself
  
  **Feature (for module authors):** an `'init'` hook now receives the component's options object beside the element, or
  `undefined`. A module reads only its own key (slots reads `observeSlots`), and core never reads, copies or validates one.
  For the key's type, a module adds it to the global `VeraInitOptions` interface that `InitOptions` extends
  (`declare global { interface VeraInitOptions { myKey?: boolean } }`), so the key exists only where that module is
  imported. For development's unknown-option check, it sets `$keys` on its hook function. Two modules claiming one key are
  reported once (`option-claimed-twice`). An unknown key is ignored in both builds, as before, and development names it.
  
  **Feature:** a connector, a function `wire` calls with the registry, is now also handed `wire` itself, so a module made
  of several insert points can take options and still be wired bare, as `slots` does. Existing connectors ignore the second
  argument. Production core grows by 1 B.
- 78fa178: `shallowRef()`'s public type drops the internal `_ignore` flag, and the README says to set up on every connection
  
  `connectedCallback` runs again every time an element is put back in the page, and `init()` there is
  what gives it current markup and live effects again; the core README now says so plainly — set up on
  every connection, keep state on the element or in a store.
  
  `shallowRef()`'s return type is `{ value: T }`; the store's internal `_ignore` flag no longer shows in
  autocomplete on every `shallowRef`.
- d4dc769: `snapshot(value)`: a deep plain copy of state, for cloning, sending or saving it
  
  A record written into a store is stored as given (its getters never run on the write), so the raw data passed to
  `createStore` can hold stores, which can't be cloned (`structuredClone`, `postMessage` and IndexedDB throw on one).
  `snapshot(state)` returns a plain copy instead: every store replaced by its data at every depth, `Map`s and `Set`s copied
  with their entries, cycles kept, and anything else (a class instance, a `Date`) kept as given. An own `__proto__` key (as
  `JSON.parse` makes) is copied as a key. It costs a walk of what it copies, only when called.
- d220d2c: A throwing `&ref` reaches the `'error'` insert, and an error nothing handles reaches `window.onerror`
  
  **`@verajs/renderer`:** an element ref that threw was caught and printed with `console.error`, but
  never reached the `'error'` insert a throwing effect reaches, so an error boundary could not see it.
  It now goes through the same chain, handed the component being rendered (a shadow root resolves to
  its host), exactly as core hands a hook's error. The render still continues past it.
  
  **`@verajs/core` and `@verajs/renderer`:** with no `'error'` handler wired, a hook or ref error went to
  `console.error` alone — so `window.onerror`, error trackers and test runners that listen for page
  errors stayed silent while a component had stopped updating. It now goes to `reportError`, which
  fires the window's `error` event without unwinding, so one failure still never stops its siblings.
  Development prints the `[vera]` sentence beside it; off-browser, where there is no `reportError`, the
  console is used as before.
  
  **`@verajs/inserts`:** the `'error'` insert's documentation says what now reaches it.
- b39a5ae: The line printed beside an error your own code threw now carries a code
  
  When a hook, a hook's cleanup, an element ref or an element claim throws and no `'error'` insert is wired, the error
  is reported the platform's way (`reportError`), and — in development, or wherever the platform has no `reportError`, as
  in Node — printed with a line of ours beside it. That line was the one message without a code. It now has one:
  production prints `[vera] hook-threw`, `[vera] cleanup-threw`, `[vera] ref-threw` or `[vera] claim-threw`, and
  development the full sentence ending in that code, so every line the framework prints carries a code. The bare codes
  are shorter than the words they replace: `vera.min.js` is 7 B smaller and `vera-renderer.min.js` 2 B.
- bb4bc7a: `!name` on a component is delivered: a running component re-renders when only a `!name` changed
  
  `!name` on a custom element wrote a plain property, so a component that was already running never heard a change to it
  alone: the element held the new value while its render went on showing the old one (a `.name` beside it, changing in
  the same render, hid this). On a hydrated page every prop arrives after the child is running, so a `!name` never
  reached it at all. It is now delivered exactly as `.name` is — template binding and `spread()` key alike — compared
  against the component's current value on every render, so an equal value costs one read and renders nothing.
  
  Also:
  - During hydration, `!name` on a built-in element is recorded only for a control's user state — `value`, `checked`,
    `selected`, `open` (the same list now applies to `.open`) — and any other `!name` is written: `!indeterminate`,
    which no markup can carry, used to be dropped on adoption.
  - A getter with no setter bound through `!name` is refused with one development warning, instead of a plain write that
    threw in module code.
- d220d2c: A component in a popped-out window or an iframe renders on that window's frames, with that window's elements
  
  **`@verajs/core`:** renders and effects were scheduled on the `requestAnimationFrame` of the window
  that loaded VeraJS, so an element moved into another window was redrawn on the opener's clock — one
  opener call and none on the iframe's, measured — and would freeze when the opener's tab was hidden.
  The default scheduler now uses the element's own window (`element.ownerDocument.defaultView`), with
  the global as the fallback. A scheduler passed to `setRenderScheduler` now receives the element as a
  second argument, `(run, element)`, so a custom one can do the same; one-argument schedulers are
  unaffected.
  
  **`@verajs/renderer`:** every template was imported through the module's `document`, so a custom
  element in a template rendered into another window was constructed by the opener's registry, with the
  opener's class — whose constructed stylesheets that window cannot adopt. Instances are now imported
  into the document they will live in, so they are built by that window's own registry.
- 0986593: `@verajs/renderer/native-elements` — built-in hosts get a custom element's lifecycle
  
  `wire([renderer, nativeElements])` lets `init(div, setup)` on a built-in element (a `div`, a `section`…) behave like a
  custom element: torn down when removed, set up again when re-added, kept on a move, and set up at its first connect
  when `init` ran off the page. Without the module, development warns once that such a host is never released.
  
  Core: an `'init'` insert now receives the setup as its third argument and may answer `false` to defer it.
- 2cea5ce: Light-DOM slots live in `@verajs/renderer/slots` — an app without them no longer ships their code
  
  **`@verajs/renderer` — breaking for custom slot strategies, which are retired.** Finding a template's `<slot>`s,
  mounting them after the first update, parking them at teardown and marking the render's own output
  in a light host all moved out of the renderer into `@verajs/renderer/slots`. The renderer keeps
  generic points they plug into: an **instance hook** a `'template'` hook may set on a template
  (`{ $c, $m, $q }` — called for every instance before its first update, once its render has finished, and at teardown,
  with nothing on the hot path for templates that have none). Slotted creation measures level with the renderer before this change on Chromium, Firefox
  and WebKit.
  
  **What it weighs, against 0.2.2, gzipped.** The renderer is 4 893 B (0.2.2: 4 679), now carrying the
  `'template'` hook `@verajs/renderer/namespaces` plugs into and the fixes below; an app that does not
  use slots is 7 403 B (7 141). The slots module is 3 874 B (3 424), and a slotted light component
  bundled with both is **10 831 B, up from 10 028 — about 800 B more** for the apps that use slots: the
  contract now crosses a bundle boundary, and those apps carry it.
  
  - `wire([renderer, slots])` is unchanged in what you write — but it needs `@verajs/core` 0.3.2 or
    later, whose `wire` accepts the nested array `slots` now is. An older core wires nothing from it,
    silently.
  - `slots` is now an array; code that read `slots.fn` or `slots.on` no longer finds them.
  - Development warns when the slots module and the renderer come from different versions of the
    package: they are one contract across a bundle boundary. An older slots module beside this
    renderer is treated as unwired in both builds — its fallback shows and nothing is lost.
  - `slotDiscovery` claims each `<slot>` through `@verajs/renderer/elements` (an `'element'` claimant)
    and carries `elements` with it; an app wiring `elements` for its own claims as well gets one
    module, not two. A `'template'` hook that sets an instance hook before `elements` is replaced, and
    development says so.
  
  **Fixed — also in 0.2.2: with slots wired, a light component's own top-level `${…}` lost its
  content on update.** `${busy ? spinner() : list()}` as a component's whole template rendered the
  spinner and then an empty host; a top-level list grew to one row of three. It hit components with
  no `<slot>` at all, because every light host is captured once slots is wired. A nested render during
  a slotted template's first update — a ref that renders a tooltip — no longer loses the slot's content
  either.
  
  **`@verajs/inserts` and `@verajs/core`: `wire` takes nested arrays**, so a module made of several
  descriptors and connectors is itself an array and sits in an app's list like any other module. The
  `Wireable` type names what `wire` accepts.
- 0986593: A server render's components are released when it ends
  
  Each `renderToString` / `renderToStringAsync` is a turn: the hooks its tree created leave every store when it ends, so
  a module-scope store read by server-rendered components no longer keeps every rendered component alive for the life of
  the process, and a later write no longer re-runs renders that already served their request.
- 46865a3: A store array's `splice`, `shift`, `sort` and other whole-array methods notify once, after they finish
  
  Called through a store, `rows.splice(4, 1)` on ten rows wrote them back one index at a time, and a hook
  that runs on every write — a raw `createHook`, or `useSyncEffect` — ran between those writes: seven
  times, six of them on a half-shifted array holding one row twice or a hole. `splice`, `push`, `pop`,
  `shift`, `unshift`, `sort`, `reverse`, `fill` and `copyWithin` now run whole on the array and then tell
  each subscriber once, so a synchronous hook only ever sees the finished array. Queued hooks (a
  component's render) already ran once and saw the end state; what they skip now is the per-index
  bookkeeping. What the methods return is unchanged: the store array itself, or the same proxies a read
  would hand back.
  `sort`'s comparator still receives the store's proxies; a comparator that writes to the store is heard mid-sort, as any
  write is, so keep comparators pure. One idiom keeps the old behavior, because it never reads the
  method through the store: `Array.prototype.push.apply(state.rows, more)` — write `state.rows.push(...more)`.
- Updated dependencies [194266a]
- Updated dependencies [8854735]
- Updated dependencies [c300bb3]
- Updated dependencies [d220d2c]
- Updated dependencies [f96bfc4]
- Updated dependencies [2cea5ce]
  - @verajs/inserts@0.2.2

## 0.3.1

### Patch Changes

- 4bfee3e: Components receive bound properties with no declaration
  
  A parent binds properties — `.date=${…}` in a template, `props({ date })` in either surface, a
  sigil-keyed spread bag — and the component reads them off `this`, reactively: a read in a render
  is tracked, the parent's next commit lands in the setter and re-renders, and stores and refs
  arrive by identity and stay live. No `static properties`, no props argument to `init()`, no
  `declare`.
  
  `props()` is the new `@verajs/renderer/spread` export: a typed bag of property bindings
  (`props<CalendarDay>({ dat })` is a compile error naming the misspelling), one call in template
  and JSX alike, idempotent under the JSX compilation shape `spread(props({…}))`.
  
  Both arrival orders work. An eagerly-defined component's values are recorded before `init()` runs;
  a lazily-defined one's are recorded before upgrade and re-applied after it, which repairs the
  ES2022 class-field clobber in BOTH spellings (`item;` and `item = default`) — a bound value
  outranks a class default. A key arriving after `init()` — a hydrated child's late parent commit, a
  spread bag growing a key — is adopted live and re-runs only the render hooks, never effects.
  A class declaring its own `get`/`set` pair keeps it: values arrive through the setter, and a
  getter with no setter refuses the binding by name in development instead of throwing — one rule
  in every arrival order. Platform properties (`title`, `id`, `slot`, `style`) land on the platform
  accessors that own them; elements that never call `init()` get plain writes exactly as before,
  with the pre-upgrade clobber warning now firing once per binding instead of once per commit.
  
  Measured: production custom-element property commits are unchanged in all three engines;
  development commits got 3–8× faster (the old clobber detector ran `customElements.get` per
  commit; detection now costs one subscription per binding).
- Updated dependencies [4bfee3e]
  - @verajs/inserts@0.2.1

## 0.3.0

### Minor Changes

- 2f20123: Reactive `Map`/`Set` moves out of core, to `@verajs/store/collections`
  
  Most stores hold plain objects, and every app was carrying 367 B gzipped for collections it never
  created. An app without a `Map` in a store is now **292 B smaller**; one with a `Map` pays **24 B**
  over having it built in.
  
  ```js
  + import { collections } from '@verajs/store/collections';
  - wire([renderer]);
  + wire([renderer, collections]);
  ```
  
  Forget it and core raises a development error naming the package the first time a collection is read
  from a store — then the call throws, because native collection methods cannot run on a proxy. It
  fails loudly, not silently.
  
  It lands beside `computed` rather than as its own package because the opt-in boundary here is the **entry**, not the package — you download only the subpath you import either way — and a package buys independent versioning these two will never need.
  
  `@verajs/inserts` gains the `'collection'` insert point this rides on. Unlike `'proxy-handler'`,
  which runs on every read of every store, it is **type-keyed**: core dispatches it only when the
  target is already known to be a `Map` or `Set`, and resolves it once per process. That is what makes
  the split affordable — it is the same shape that made `@verajs/map-support` too expensive in its
  first incarnation.
- 54412a4: Export `svg` and `mathml`, and stop re-exporting `connectInserts`.
  
  **`svg` and `mathml` were defined and never exported.** `@verajs/renderer` has always read
  `_$litType$` and wrapped markup in `<svg>` or `<math>` before parsing, precisely so the fragment
  lands in the right namespace — but nothing in core produced those types, so the support was
  unreachable. A user had to import lit-html's `svg` or hand-craft `{ _$litType$: 2, strings, values }`.
  
  Namespace is not a nicety here: `document.createElement('circle')` produces an `HTMLUnknownElement`
  that parses fine and never renders. Only a fragment parsed inside `<svg>` yields a real
  `SVGCircleElement`. Costs 32 B for both.
  
  **`connectInserts` is no longer re-exported from core.** It connects *a module's* registry to core's,
  so every documented use imports it from the module being connected — `@verajs/router` — never from
  here. Re-exporting it made core carry its replay loop for a call nothing makes, and core is 24 B
  smaller without it. The types are still re-exported, so `RendererInsert`, `InitInsert` and the rest
  remain available from `@verajs/core`; only the value is gone, and TypeScript reports its use
  precisely rather than failing at runtime.
  
  This is the breaking part, hence minor. Only `@verajs/core` and `@verajs/router` carry a registry at
  all — and by the time this releases neither does: the router is handed core's through
  `wire([router])`, and `connectInserts` is gone with the concept.
  
  Net effect on core: 2 577 B to 2 585 B, +8 B for two exported tags and a smaller insert surface.
- a5453bd: `mount()` commits a component's setup without drawing anything, and `render`'s template argument is
  now required.
  
  `init()` opens a component's setup and one of two calls closes it — running the first pass of every
  hook registered since `init()` and clearing the instance:
  
  ```js
  connectedCallback() {
    init(this);
    const state = createStore({ online: navigator.onLine });
    useEffect(() => report(state.online));
    mount();                       // a component with no markup
  }
  ```
  
  `render(template)` is exactly `useRender(template)` followed by that same commit — a compound over
  the base operation, not a second way to do the same thing, which is why a component only ever calls
  one of them.
  
  **Why this reverses an earlier decision.** A bare `render()` used to be how a side-effect-only
  component committed: legal, documented, and guessed by nobody, because "render" names the one thing
  the call is not doing. A standalone commit function was built once and rejected on size — 25 B
  against 6 B — and that comparison could not measure the failure it was trading away. Hooks that are
  never committed never run: no error, no render, an effect that simply does not happen. `mount()`
  costs 35 B gzipped in core and makes that failure findable.
  
  A bare `render()` still commits and warns, naming `mount()`. Refusing would turn a spelling
  preference into effects that silently never run — the exact failure this exists to prevent. The
  break is at the type level: `render()` with no argument no longer compiles, which is why this is a
  minor rather than a patch.
  
  Development warnings updated to match: the "registered N hooks but never committed" warning now
  names both calls, and "hook ignored" names the `render()` or `mount()` that ends setup.
- b7adb81: `setAutoloader` and `connectInserts` are gone; one way to install a module
  
  Every module now hands `wire` a descriptor, and the registry package no longer knows about any
  particular consumer.
  
  **`setAutoloader(fn)` → `wire(instance)`, and `initAutoloader` is now `autoloader`.** The instance is
  also its own descriptor, so configuring and installing are one call, and the name matches every
  other module you hand `wire`:
  
  ```js
  - import { setAutoloader } from '@verajs/core';
  - import { initAutoloader } from '@verajs/autoloader';
  - setAutoloader(initAutoloader(import.meta.url, 'components'));
  + import { wire } from '@verajs/core';
  + import { autoloader } from '@verajs/autoloader';
  + wire([renderer, router, autoloader(import.meta.url, 'components')]);
  ```
  
  `wire` now tests for a descriptor — anything naming an insert point — *before* the connector case, so
  a module can be both a function and a descriptor. Without that order such a module is called as a
  connector and silently never registers.
  
  **`connectRouter` is now `router`.** `wire` is the verb, so what you hand it is named for the thing,
  not the act — and whether a given module is a descriptor or a connector is an implementation detail
  an app should not have to read off a name:
  
  ```js
  - wire([connectRouter]);
  + wire([renderer, router, collections, autoloader(import.meta.url, 'components')]);
  ```
  
  **`domRender` is now `renderer`**, in `@verajs/renderer` and `@verajs/renderer/hydrate` alike — so
  swapping to hydration really is swapping one import. `render` is still exported for direct use, and
  because the two names are close, wiring the wrong one now **throws in development** naming the one
  you meant. It used to be silent: a bare function has no `on`, so `wire` read it as a connector,
  handed it the registry and registered nothing.
  
  **`connectInserts` is removed.** It replayed one registry's chains into another; nothing needs that
  now that every module takes the registry it writes to (`router` for the router, `wire` from
  core for everything else). Two copies of `@verajs/inserts` in one page is a mistake with no repair
  function, rather than a supported arrangement.
  
  **`@verajs/eslint-config` restricts `wire`, not `insert`.** The rule named an import that stopped
  existing at the 0.2.0 rename, so the production-silent registry mistake it exists to catch had been
  unguarded since.

### Patch Changes

- 57ab91d: Ten public APIs now name the mistake instead of leaking an internal
  
  The second audit sweep took passes 22 and 80's lens again — wrong-typed input to every public
  function — but **mechanically** this time: every export of all thirteen entry points, crossed with
  seven wrong values, filtered for errors that name an internal rather than the call. The hand-picked
  passes had found three defects; enumerating found six more.
  
  **The worst was silent.** `html('<p>hi</p>')` — the call form rather than the tagged form, which is
  how the same job is done in libraries that take a markup string — returned a template-shaped object
  with a *string* where the strings array belongs. It passed every shape check and failed much later
  inside the renderer with `Invalid value used as weak map key`, because the template cache is keyed by
  the strings array and a string is not a legal key. Nothing in that message mentions `html`. `svg` and
  `mathml` did the same; `css` threw `strings.reduce is not a function`.
  
  Also guarded: `untrack(state.a)` instead of `untrack(() => state.a)` — which reads the property
  *before* untrack is entered, so it is tracked after all, the opposite of what was asked — plus
  `renderInto` with no container, `keyed` with no template, `tag('h1')` called instead of tagged,
  `navigate(undefined)` (an async throw, so it surfaced as an unhandled rejection naming nothing), and
  both `@verajs/styles` entries.
  
  The template-literal check is `Array.isArray` and deliberately **not** `raw`: a hand-built
  `html([markup])` works and `ssr-scale.test.mjs` builds a hundred nested components that way. That
  shape does churn template identity, which is the render profiler's business to report rather than
  this guard's to forbid. The defect fixed here is the silent one.
  
  All `__DEV__`-only, so production carries none of it.
- e6d06e4: Document what a shadow root does to ARIA, and prove the ways through
  
  `docs/CODE-PRINCIPLES.md` says accessibility is not a follow-up, `init(this, { mode: 'open' })` is the
  documented way to write a component, and nothing anywhere said what that costs.
  
  **Every ID-based ARIA relationship resolves within a single tree.** `aria-labelledby`,
  `aria-describedby` and `<label for>` all match by ID, and IDs do not cross a shadow boundary — so a
  page-level label cannot name a control inside a component. There is no error and no warning, just an
  element with no accessible name. That is the platform's rule, not this framework's, and it is now in
  the core README beside the `init` entry that creates it, and in `llms.txt`.
  
  Three ways through, each with a browser test rather than a claim: keep the relationship inside one
  template; put a role and name on the **host** with `ElementInternals`, which lives in the outer tree
  (`attachInternals()` before `init`, which does not clobber it); or use light DOM, where `static
  styles` still applies. `delegatesFocus: true` forwards host focus to the first focusable child.
  
  Documentation only — no behaviour changed. `tests/browser/aria-shadow-boundary.test.js` establishes
  the platform rule and executes all three recommendations in Chromium, Firefox and WebKit, because
  advice that has not been run is a guess.
- 1e89906: Audit fixes: falsy guards, write suppression, and a 13% faster read path
  
  Three correctness defects in core, all the same shape — a legal falsy value tested for truth:
  
  - **`css` dropped a zero.** `margin: ${0}px` produced `margin: px` and `z-index: ${0}` produced
    `z-index: `, declarations the parser discards, so a rule silently lost a property. Every zero out
    of a computed layout hit it.
  - **Hook priority `0` registered nothing.** Lower runs earlier, so zero is the earliest priority
    there is and the obvious choice for a hook that must run first — and it was the one value that did
    not work. Now the same finite-number rule `wire` uses, which also catches `NaN`.
  - **`defineProperty` suppression was process-wide.** Any write in flight suppressed every definition
    anywhere, so a setter that defined a property — on another key, or another store — notified nobody.
  
  Two more found by probing stores over unusual targets:
  
  - **`createStore(Object.freeze(config))` threw**, and under it a proxy-invariant violation: reading
    any nested object out of a frozen store threw a `TypeError` from the engine.
  - **`createStore(x)` twice returned two proxies**, so the same nested object read through each was
    two different values.
  
  **Reads are 13% faster.** The `'proxy-handler'` chain was resolved from a `Map` on every property
  read of every store; it is now cached against a registry revision. Measured on
  `bench/reactivity.mjs`: a tracked flat read 150 → 131 ns/op, two hops 478 → 442.
  
  Development-only diagnostics, all free in production: a string in tag position is refused rather
  than rendered as escaped punctuation; an un-hoisted `_$child$` applier is named; a self-feeding
  `useSyncEffect` is stopped at depth 50; and the missing-`@verajs/store/collections` error is raised once
  per page rather than once per read, and from a `size` read as well as a method read.
- b67cd36: `render()` with no template commits a component's setup without drawing anything.
  
  It has always done two jobs — declare the markup, and end the setup by running the first pass of
  every hook registered since `init()`. A component whose whole job is a side effect (analytics,
  syncing, focus management, a store subscription) has nothing to draw and had to write
  `render(() => html``)` to get its effects to run at all: ceremony that pretends to draw. Forget it
  and nothing happens, silently — the hooks exist and nobody runs them.
  
  ```js
  connectedCallback() {
    init(this);
    useEffect(() => track(session.page));
    render();
  }
  ```
  
  Existing light DOM is untouched, since nothing renders into it.
  
  Two alternatives were built and measured first. A separate `commit()` cost 25 B against 6 B and
  added a second function to choose between. Committing automatically after `connectedCallback` cost
  31 B and ran a headless component's effects a microtask later than a rendering component's — the
  same code with two orderings depending on whether it drew anything.
  
  Development also warns when `render()` is never called, naming the component and its hook count.
  Detected without carrying any state, since `render()` clears the current instance; the check can
  miss a case when another component mounts first, but cannot invent one. Production carries neither
  the check nor the message.
- 0db2f4e: An element that removes itself inside its own effect still runs that effect's cleanup
  
  `disconnectedCallback` runs every cleanup and clears the set. A cleanup is registered when the effect
  *returns*, so an effect that calls `this.remove()` — a toast dismissing itself, a component that
  redirects — finished **after** that sweep and added its cleanup to a set nothing would ever drain
  again. The interval, listener or subscription it was meant to release ran forever, silently: exactly
  the failure the cleanup registry exists to prevent, reached by the one ordering that steps around it.
  
  A cleanup registered after the sweep now runs immediately, which is what the teardown would have done
  a moment earlier.
  
  The element is tracked as removed rather than tested with `isConnected`, because a component rendered
  into a detached container has never been connected and is still owed a later removal.
- 4ad3d73: `init(element, { mode: 'closed' })` works.
  
  `init` called `attachShadow` and discarded what it returned, and everything downstream read
  `element.shadowRoot` — which is `null` for a closed root, by definition. So a closed component
  rendered its content into the **light DOM**, never adopted its styles, and left an empty unreachable
  shadow root behind. Measured with no SSR involved: `mode: 'closed'` put `<p>content</p>` in the light
  DOM while `mode: 'open'` put it in the shadow root.
  
  The root is kept on the element as `_root` — a cross-boundary contract like `_hooks`, read by the
  `'render'` insert and by `@verajs/styles`, and never mangled. A second `init` on a closed element is
  guarded, which `shadowRoot` alone could not do.
  
  `tests/browser/shadow-modes.test.js` covers every mode as a matrix rather than testing the one bug:
  content lands in the root, styles adopt into it and actually apply, and nothing leaks to the light
  DOM. Light DOM is asserted to create no root at all.
- 0bbabfc: `_cleanups` joins the mangle exemptions — it is a cross-boundary contract
  
  Core's production build mangles `_`-prefixed properties, with an exemption list for the names
  other bundles reach structurally: `_p`, `_isSignal`, `_ignore`, `_delete`, `_root`, `_hooks`,
  `_$…`. `_cleanups` was not on it, and it is exactly such a contract: `@verajs/motion`'s vera
  adapter registers each component's release into `element._cleanups`, which core drains on
  `disconnectedCallback`. In every production build the drain read a renamed property, the
  adapter's optional-chained read came back `undefined`, and component roots were never released
  on unmount — silently, and in production only, the same failure shape `_hooks`' own docblock
  warns about.
  
  Found by a cross-package sweep for structural `_` reads (2026-09-01): the full set reaching
  across bundles is `_root` (styles' closed-shadow-root fallback, and the motion adapter) and
  `_cleanups` (the motion adapter) — the first was already exempt, the second now is.
  `tests/core-structural-contracts.test.mjs` pins both on a live element, in the production run
  where the defect lived; verified to fail against the unfixed build.
- 053fd5d: Stop shipping a development warning to production, and give `useEffect` the swappable scheduler.
  
  **A `console.warn` was not behind `__DEV__`.** The "hook ignored — register between init() and
  render()" message shipped in every production bundle, message text and all. Guarding it removes
  **65 B**, 2.4% of the package, for a diagnostic no production user can act on. Every other warning in
  core was already guarded; this one was missed.
  
  **`useEffect` hardcoded its own `requestAnimationFrame`,** byte-for-byte identical to
  `animationFrame` in `setRenderScheduler` — including the `typeof` guard for off-browser
  environments. Beyond the duplication, it meant `setRenderScheduler(microtask)` moved renders and
  left effects on animation frames: an author who chose microtask scheduling precisely to escape the
  frame boundary still waited one for every effect. Measured — the order stayed `layout → render →
  effect`, but the effect arrived up to a frame later than the other two. Both now use one scheduler.
  
  Also removes 26 lines of commented-out lit code from `store.ts`, a third of that file, sitting
  unlabelled beside production code.
  
  Core is 2 686 B to 2 620 B.
- dd76fb8: Every published package declares `engines: node >= 20`
  
  No published package declared an `engines` field at all, so a consumer was told nothing about which
  Node this is built for. The root's `>=18.15.0` looked like the answer and was not: the root is
  private and never published, so it governed only this repo's own development.
  
  It was also not true. Node 18 reached end of life in April 2025, CI has only ever run Node 24, and
  nothing has verified an 18 install in a long time — so the floor was a claim nobody was checking.
  Declaring the one we actually test is a fix rather than a restriction, and it is what lets
  `@verajs/ssr` use the `crypto.randomUUID()` that has been global since Node 19.
- afd78b6: The framework now survives your callbacks throwing, instead of quietly stopping.
  
  **A cleanup that threw killed its effect for the life of the component.** `invoke` opened with a
  bare `cleanup?.()`, so the throw took the whole call with it: the effect body never ran, `cleanup`
  was never replaced, and the next pass called the same throwing function again. Every later write
  reported the same error and changed nothing. `swapCleanup` already guarded exactly this on the
  disconnect path, so the gap was the path a component spends its whole life on.
  
  **A cleanup could run twice.** `cleanup = next` was the last statement, so an effect body that threw
  left `cleanup` holding the previous pass's teardown — which had already run a line earlier. Invisible
  for a teardown that removes a listener; not for one that releases a lock or closes a socket, and it
  only happens while something else is already going wrong.
  
  **A ref callback that threw emptied the component and it never rendered again.** A ref runs in the
  middle of committing a template's parts, so the throw unwound the render and left the commit half
  applied: the shadow root ended up empty and stayed that way. The error was reported, so the only
  symptom was a component that had silently stopped existing. It is now named as a ref and the render
  continues without it — the same judgement `handleEvent` already makes for a handler that cannot
  listen.
  
  Found by making user code throw at every point the framework calls it, and checking not just that
  the throw was reported but that the framework was still usable afterwards.
- 391a20d: Fold a subscription's priority order in beside its callbacks
  
  `addCallback` kept each element's priority-ordered callback sets in one place and the parallel
  priorities in a **separate `WeakMap` keyed by that array** — so every tracked read paid a
  `WeakMap.get` to recover something only the insert path ever looks at. `runCallbacks` walks the slots
  by index and never consults the order at all; the comment above the declaration claimed otherwise.
  
  They are one fact, so they now travel together as `PropSubscriptions`: one object where there were two
  arrays and a `WeakMap` entry.
  
  Worth ~10% of a server render — **5.53 and 5.54 µs against a baseline of 6.16 to 8.40**, fastest of
  nine rounds over 20 000 renders, with the baseline re-measured after restoring. The folded runs are
  also markedly tighter, which is the allocation showing up as GC variance. A client micro-benchmark
  that reads one property 200 000 times sees no change at all, and that is the point: it is maximally
  cache-friendly, while every subscription on a server is built cold and thrown away.
  
  2 B gzipped.
- 507fdd6: Stop allocating a closure on every tracked read
  
  `addCallback` ends with `prioritySlot(byPriority, order, priority, () => new Set())`, and that arrow
  was built on **every tracked property read** while only ever being called on the first one — directly
  contradicting the comment two lines above it, which says the steady state is allocation-free. It was
  not. `createHook` carried the same shape.
  
  Found by heap-profiling a server render, where the proxy's `get` trap accounts for **43% of all
  allocation per render**: on a server every render is cold, so the subscription graph is built once and
  discarded, and nothing reaches the steady state the hot path is tuned for.
  
  Hoisting the factory to a module constant is behaviour-identical — `prioritySlot` still takes a
  factory so the slot is built only when missing, which is worth keeping; only the factory stops being
  rebuilt. Measured on the SSR component render, fastest of nine rounds over 20 000 renders, twice:
  **6.14 and 6.37 µs against 6.73 and 6.79** inline. 7 B gzipped.
- c926257: Warn in development when a component registers hooks but never calls `render()`.
  
  `render()` is what drives the first pass: it calls `runHooks()` and then clears the current
  instance. A component that registers effects and never renders therefore does nothing at all — the
  hooks exist and nobody runs them. Silent, and easy to write, because a component whose whole job is
  a side effect (analytics, syncing, focus management) has no obvious reason to render markup.
  
  Detected without adding state: if the element is still the current instance once the synchronous
  `connectedCallback` has finished, `render()` was never reached. A component mounting after this one
  moves that pointer, so the check can miss a case but cannot invent one. `__DEV__`-only — the
  production bundle is unchanged at 2 680 B and contains neither the check nor the message.
  
  `tests/core-hook-lifecycle.test.mjs` covers the rest of the lifecycle alongside it: cleanup on
  removal, no renders while detached, four attach/detach cycles leaving exactly one live hook, error
  isolation across hooks in both directions, and `untrack`.
- 8a792b4: Say when a second `init()` discards the hooks registered before it
  
  `init()` starts a fresh generation of hooks, and dropping the previous one is correct and
  load-bearing: `connectedCallback` runs again every time an element is re-added — a router navigating
  back, a list reordering, a conditional subtree returning — and a fresh generation is what stops
  effects from doubling.
  
  Called **twice in one setup** it is a mistake instead, and every hook registered between the two
  calls was silently discarded. `init(); useEffect(fn); init(); render(...)` never ran `fn`, with no
  error and no warning — an effect that looks registered and is not.
  
  It now says so, names how many hooks were lost, and explains why they were. The reconnect path stays
  silent, which is asserted alongside: a diagnostic that fired on every router navigation would be
  worse than none.
  
  `__DEV__`-only; production carries neither the check nor the message.
- a7336b5: Explain a write the language refused, instead of leaving the engine to talk about proxy traps.
  
  A store is a proxy, so a refused write has to be reported by returning `false`, and the engine turns
  that into `TypeError: 'set' on proxy: trap returned falsish for property 'n'` — a message about the
  trap, which is internals the reader never wrote. The same assignment to an unproxied frozen object
  says `Cannot assign to read only property 'n'`, so putting a store in front of an object made the
  diagnosis worse. `createStore(Object.freeze(defaults))` is an ordinary thing to write, and a frozen
  constants table nested in state is how it usually turns up.
  
  Development now names the rule that refused — frozen, sealed with a new key, non-extensible,
  `writable: false`, or a getter with no setter — for both `set` and `delete`. It reports rather than
  repairs, because every one of these is a language invariant and not a framework decision.
  
  `__DEV__`-only: **0 B in production**, verified against the built bundle, and it throws in both builds
  either way.
- c796080: Say "no renderer wired" in production too, not only in development
  
  Core ships no renderer of its own, so a component that renders with nothing wired produces an empty
  page. Three separate mistakes end there — `wire` never called, wired with an import name that
  resolved to nothing, or handed something that is not a module — and every one of them was
  **completely silent in production**: no warning from `render()`, none from `wire`, nothing anywhere.
  A blank page and no explanation.
  
  That matters because **buildless is a first-class mode**. Someone pasting `vera.min.js` into CodePen
  from a CDN never runs a development build, so a `__DEV__`-only diagnostic is invisible to exactly the
  person most likely to have forgotten the wiring — and this is the framework's most likely first
  mistake.
  
  `render()` now warns in both builds. Development keeps the full message with the two lines that fix
  it; production carries a short one. Warned **once per process** and only on the failing path, so a
  working app never reaches it. Costs 36 gzipped bytes.
  
  Found by running the same behavioural matrix against the development and production builds and
  diffing the results — 13 behaviours, one of which differed.
- e7e56f5: A dead-code and consistency sweep from the full-line read — no behaviour changes
  
  Every removal was verified unreachable before it went: core's `runHooks` kept an optional call on a
  value already guarded, and `runCallbacks` re-fetched through two map lookups the very set it was
  iterating; the ssr serializer's final `raw` ternary sat below the early return that makes it
  unreachable, an entity-table entry could never match its own regex branch, and the fragment parser
  carried a variable it only ever `void`ed; the JSX transform now initialises `usedSpread` beside its
  two siblings instead of relying on undefined-is-falsy.
  
  Also in `@verajs/ssr`: the Set-diff that recovered "the entry `setRenderer` registered" around the
  `wire()` call was a leftover from an API that registered a wrapper. `wire` registers the function it
  is handed, so the renderer-displacement guard now asks the chain for `serverRenderer` by identity —
  same check, two lines and one allocation fewer, and the comments above it stop teaching a removed
  API.
  
  Net −16 B gzipped on `@verajs/core`; size claims re-synced.
- 7392f46: Notify on array appends and on `delete`. **Two reactivity bugs.**
  
  **Appending to an array moved `length` without reporting it.** Assigning `list[3]` on a
  three-element array updates `length` as an internal consequence, so nothing passes through the `set`
  trap for `length` and a hook that read it was never told. `push` and `unshift` were silently inert;
  `splice` and `pop` worked, because those assign `length` explicitly. A list rendered from
  `items.length` simply stopped updating when you appended to it, with no error.
  
  **Deleting a property notified nothing at all.** The `deleteProperty` trap returned success without
  running callbacks, so a hook reading that property kept the value it last saw.
  
  Both are fixed at the trap. Precision is unchanged and asserted: an append does not wake a hook that
  read only `list[0]`, a non-index key on an array is not treated as growth, deleting an absent or
  unread property stays silent, and an explicit `length` write still notifies exactly once.
  
  Costs 63 B gzipped.
- cc7a3f0: Documentation. Core's README was eleven lines for the package everything else is built on; it is now
  a full one, with a runnable recipe, tables for state, effects, rendering and extension, and the two
  mistakes that actually bite — undeclared TypeScript class fields, and swapping subtrees where a
  stable shape would do. It also no longer claims to have no dependencies while depending on
  `@verajs/inserts`.
  
  `@verajs/inserts` gains the part that was missing: what an extension *is*, with the four shipped
  ones named as examples of the same five points and the same public function you have.
- c346153: Name a self-feeding render loop in development, without stopping it
  
  `useEffect(() => { state.total = sum(state.rows) })` next to a template reading `state.total` pegs a
  core for as long as the page is open: 11 runs in 10 frames, forever, with no error, no warning, and
  nothing to search the console for. `useSyncEffect` has stopped and named its own recursion for a
  while; the coalesced path — `useEffect`, `useLayoutEffect`, and a template that writes what it reads
  — said nothing at all.
  
  It warns rather than throws, and this is the whole design question rather than a hedge. Vera's
  default scheduler is an animation frame, so an effect that writes what it reads already runs once per
  frame — which is also how you write an animation. React draws exactly this line (`throw` on the
  synchronous cascade, `console.error` on the coalesced one, neither shipped to production) and Lit
  warns without stopping and names the legitimate case inside the warning text. Both are followed here.
  
  **What is counted is not frames.** It is consecutive passes that fed *themselves*, reset by the first
  pass that does not — React's `nestedUpdateCount` rule. A write that lands outside the pass, from your
  own `requestAnimationFrame`, a timer or an event, never trips it at any threshold, so an animation
  driven that way is silent by construction rather than by tuning. The count is kept per element **and**
  per hook: shared globally, fifty unrelated components that each write once look like one component
  looping fifty times, and keyed on the last element to feed, two instances of one buggy component
  alternate and neither is ever reported.
  
  **`allowRenderLoop(element)`** marks a loop as deliberate for a component that means it — the escape
  hatch Lit ships and React does not, and the one the animation framework needs. A no-op in production.
  
  `__DEV__`-only: **+14 B gzipped** for the detection and **+12 B** for the exported opt-out, and the
  production bundle contains neither the counters nor the text. Three collections are marked
  `@__PURE__` because a bare `new WeakSet()` at module scope is a constructor call the minifier must
  assume has side effects — production was keeping the allocations with their bindings dropped.
- 98d9ce5: The warning for `render()` with no template no longer says something untrue.
  
  It read: *"render() needs a template. If this component has no markup, call mount() instead — it
  commits the setup and runs the hooks, which is what a bare render() used to do."* Both halves are
  false of the function printing them. It does not need a template, and it still commits exactly as it
  always did — the paragraph directly above the message in the source says so: *"It commits anyway.
  Refusing would convert a naming preference into a component whose effects never run."*
  
  Read at runtime by someone debugging, it says "your hooks are not running", which sends them looking
  for a fault that is not there. The message now says what happens — the setup is committed and the
  hooks run — and recommends `mount()` as the name for it.
  
  Behaviour is unchanged. The test that covered this matched the literal old string, which is how the
  message was able to drift into contradicting the assertion two lines above it; it now requires the
  warning to name `mount()` and to make no claim that the hooks failed to run.
- 60cc173: A scheduler that throws no longer freezes the component forever
  
  Every render and every effect passes through whatever `setRenderScheduler` holds, which makes it the
  widest blast radius in core — and pass 92 was the first audit to point at it.
  
  The coalescing flag is raised *before* the pass is handed to the scheduler and lowered *inside* it, so
  a scheduler that never runs the pass left it raised and every later write returned early. The
  component then stopped rendering **permanently**: measured frozen at its initial value, with no error
  and no warning, and not revived by restoring the default scheduler. The effect path had the same
  shape under a different flag name, so renders and effects both went silent.
  
  Worse, it is invisible at the call site: `createHook` isolates a hook's error to the `'error'` insert
  so one bad hook cannot take out its siblings, which means the throw never reaches the code doing
  `state.n = 1`.
  
  The flag is now released when the scheduler throws, and a pass **stranded** by a scheduler that drops
  it is re-queued once that scheduler is replaced.
  
  The second half was nearly left unfixed, on the reasoning that a dropped pass cannot be told apart
  from a deferred one. That is true *at the moment of scheduling*, and that is not the only moment:
  once the scheduler has been replaced, whatever the old one was holding is provably never going to
  run, because nothing will ever call it again. `setRenderScheduler` bumps a generation — a live
  binding, exactly as `revision` is in `@verajs/inserts` — and the coalescing guard stops honouring a
  flag raised under a scheduler that no longer exists. A component that never renders again is not
  something to leave standing behind an argument about contracts.
  
  Coalescing is unaffected within a single scheduler, which the suite asserts directly: twenty writes
  in one tick still produce exactly one render. 30 B gzipped.
  
  `tests/core-scheduler.test.mjs` also executes the `flushSync` recipe `llms.txt` publishes for View
  Transitions, verifying it renders synchronously and restores the previous scheduler, and exercises the
  exported `microtask` scheduler.
- 845d31f: The size audit's no-decision tier: −96 B gzipped on the counter app, nothing changes behaviour
  
  Four levers, every one measured A-B-A on `bench/size.mjs`'s counter (6,197 → 6,101 B gzipped;
  the keyed list moves 6,672 → 6,573):
  
  - Terser is told what it is emitting — `ecma: 2020`, `module: true`, `pure_getters: true` — and
    keeps `@__PURE__` annotations in the min bundles so a consumer's bundler can tree-shake the
    module-scope calls that build core's `svg` and `mathml` tags, which every app carried whether it
    used them or not.
  - Core opts into the property mangling the renderer has always had, with every cross-boundary name
    reserved by lookahead: `_p`, `_isSignal`/`_ignore`/`_delete`, `_root` (read by `@verajs/styles`),
    `_hooks` (the prod suite reads it — tests are a boundary, and `tests/minification-contracts`
    says so), and the `_$…$` family.
  - `__HYDRATING__` folds per entry, exactly as `__DEV__` folds per mode: the three adoption
    branches in `AttrPart._commit` are reachable only from the hydrate entry, so the base bundle
    stops shipping them as dead code.
  - The element-ref failure report keeps its full sentence in development and the `[vera]` prefix
    plus the error object in production.
  
  Two candidates from the same audit were rejected by the suite's own recorded contracts and are
  kept as-is: `init` and `createStore` name themselves in production (`tests/core-lifecycle`
  asserts both messages there).
- 2cefc25: `renderToString(url, { static: true })` — about 3x, for a page that will not be interactive
  
  A server render is one shot: the subscriptions built while it runs are never fired afterwards, so
  tracking every property read to create them is pure cost. Measured on a component rendering twenty
  rows, the proxy behind `createStore` is the **entire** reactivity overhead of a server render — about
  40 µs against a 15 µs baseline — while effects and the scheduler cost nothing detectable. With
  `static` on, `createStore` hands back the object it was given and reads are ordinary property access.
  
  **The markup is identical**, and that is the whole safety of it. It is not asserted on an example:
  `tests/ssr-static-mode.test.mjs` renders *every* fixture in the suite both ways and compares markup,
  styles and title. A mode that cannot drift is why this is a flag rather than a second renderer.
  
  **A store written to during a static render throws**, naming the option, rather than rendering markup
  that reflects none of the writes. That guard is deliberately **not** development-only, unlike most of
  this framework's diagnostics: a server runs the production build, so folding it away would remove it
  from the only place it matters. It is free — the proxy has no `get` trap, which is where the cost of
  a reactive store actually is.
  
  `@verajs/core` gains `setStaticStores`, which is what `@verajs/ssr` calls. It is server-side only:
  leaving it on in a browser gives you a framework that does not update.
  
  **Size:** an app that uses `createStore` grows **47 gzipped bytes** (6 026 → 6 073 B), which moves it
  from 5th to 6th in the comparative table — 42 B behind Preact, where it was 5 B ahead. An app that
  does not use `createStore` is **unchanged at 5 005 B**, because the branch tree-shakes away with the
  store it belongs to.
- eb4e8e2: Assigning a nested object back into its own slot is no longer treated as a change.
  
  The set trap read the previous value off the raw target while the getter hands out that object's
  proxy, so `state.o = state.o` compared proxy against raw, notified every subscriber that nothing had
  happened, and wrote the proxy into the target — where code still holding the object the store was
  built from saw its own property stop being what it passed in.
  
  The idiom it cost is the common one. `state.items = update(state.items)`, where `update` returns its
  input untouched when there is nothing to do, is how "no change" is normally written, and it bought a
  render pass every time with no symptom other than work nobody asked for. The primitive half of the
  rule was already there — `state.n = 1` was correctly quiet — which makes this a gap rather than a
  decision.
  
  Core grows 11 B gzipped. Primitive writes are unaffected (the check short-circuits on `typeof`);
  an object-identity write costs one `WeakMap` lookup, measured at 5.4 ns.
- d73b937: `@verajs/styles` exports a `styles` module, so it wires like every other package:
  
  ```js
  wire([renderer, styles]);
  ```
  
  Previously this package alone made an app entry hand-write `{ on: 'init', fn: adoptStyles, priority:
  50 }` — knowing which insert point style adoption belongs to, and that 50 is the number, in order to
  use a package whose whole job is one registration. `renderer`, `router`, `autoloader` and
  `collections` all export a module; `styles` was the exception.
  
  `adoptStyles` is unchanged and still exported: the longhand is what to write for a non-default
  priority. It is now marked so that `wire([adoptStyles])` — a bare function, which `wire` would
  otherwise treat as a connector and silently register nothing — throws and names `styles` instead, the
  same way `render` names `renderer`.
  
  Costs 40 B gzipped in `@verajs/styles`. Core's "nothing is adopting them" warning now prints the
  short form.
- fe2891b: Make `WeakMap` and `WeakSet` reactive.
  
  They were the one collection gap against Vue, which supports all four. Mutating one in a store used
  to succeed and simply not re-render, leaving the DOM stale — a silent staleness rather than an error.
  
  The obstacle was never the proxying, it was where dependencies live. Per-key dependencies are keyed
  by the collection's own entry keys, and the ordinary `Map` container would have held every tracked
  key alive for as long as the collection — exactly the retention the weak types exist to avoid.
  Supporting them naively is a memory leak, which is worse than not supporting them.
  
  A weak collection now gets a `WeakMap` container instead, chosen once on the first tracked read so
  the hot path never pays for the check. The two shapes stay interchangeable because only `get` and
  `set` are ever called on the container, and a weak collection never reaches the string `'_global'`
  channel: `set`/`add`/`delete` *notify* it, which is a `get` and misses harmlessly, while only
  `entries`/`keys`/`values`/`forEach` *track* it — and none of those exist on a weak collection.
  
  Proven weak rather than assumed: three keys tracked, dereferenced and collected under
  `--expose-gc`. Per-key precision holds — a key nothing read does not re-run — and object-keyed
  regular `Map`s keep the strong container and their `size` channel.
  
  `Date` and `RegExp` remain unproxied, as they are in Vue. Their methods read internal slots, so a
  bare proxy throws, and reactivity would mean wrapping every mutator for a case whose idiom is
  replacement: `state.when = new Date(t)` is a property write and already reactive.
  
  Costs **30 B gzipped** in core. (Stated as a delta rather than a before-and-after: several changes
  release together, so an absolute figure written here would be wrong by the time it publishes.)
- Updated dependencies [1e89906]
- Updated dependencies [4ad3d73]
- Updated dependencies [2f20123]
- Updated dependencies [dd76fb8]
- Updated dependencies [5a28ddf]
- Updated dependencies [cc7a3f0]
- Updated dependencies [e3a0a4d]
- Updated dependencies [b7adb81]
  - @verajs/inserts@0.2.0

## 0.2.1

### Patch Changes

- fce7683: Fix `ref()` and `shallowRef()` returning a union that made `.value` unusable.
  
  `ref<T>()` declared `{ value: T } | { value: { value: T } }`, so `.value` typed as
  `T | { value: T }` at every call site. Neither `count.value++` nor `count.value = 1` compiled —
  `ref` was effectively unusable from TypeScript, which no test caught because the `.mjs` suites run
  against built JavaScript and never see the `.d.ts` layer.
  
  The union originates in `createHandler`, typed `ProxyHandler<T | { value: T }>` to cover the wrap
  `createProxy` performs for a non-proxyable target. `new Proxy(target, handler)` infers its type
  parameter from the handler as well as the target, so the union propagated out as `createProxy`'s
  return type. `createStore` never showed it only because it already casts (`as Store<T>`); `ref`
  did not. Both `ref` and `shallowRef` now cast the same way — provably sound, since an object
  literal is always proxyable and the wrapping branch is unreachable for them.
  
  Types only. The emitted JavaScript is byte-identical, so no runtime behaviour and no bundle size
  changes.
  
  Guarded by `tests/types/public-api.ts`, a type-level suite that fails `tsc` rather than running,
  now covered by `npm run typecheck`.

## 0.2.0

### Minor Changes

- a6a6509: **Breaking:** `static styles` adoption has moved out of core into the new `@verajs/styles` package,
  and `adoptStyles` is no longer exported from `@verajs/core`. Wire it once at your app entry:
  
  ```js
  import { insert } from '@verajs/core';
  import { adoptStyles } from '@verajs/styles';
  insert('init', adoptStyles, 50);
  ```
  
  A component declaring `static styles` with nothing adopting them now warns once in development,
  naming the three lines to add. Production is unaffected — the warning is behind `__DEV__`.
  
  Core drops from 3 101 B to 2 801 B gzipped, and a working app (core + renderer) from 6 091 B to
  5 759 B — below Lit and Preact + signals again. Apps that use `static styles` add `@verajs/styles`
  (520 B) back; apps that do not simply stop paying for it.
  
  `@verajs/inserts` gains a fifth extension point, `'init'`, which core dispatches once per element
  after its shadow root exists and before its first render. That is the seam the extraction needed,
  and it is available to any module that wants to see every component as it comes to life.
- 3160255: **Breaking:** core no longer ships a default renderer. `@verajs/core` on its own cannot render;
  wire one once at your app entry:
  
  ```js
  import { setRenderer } from '@verajs/core';
  import { render as renderer } from '@verajs/renderer';
  setRenderer(renderer);
  ```
  
  `render()` with no renderer registered now warns once in development, naming those exact lines.
  Production carries no warning — it is behind `__DEV__`.
  
  The default renderer existed so core alone would render *something* without a renderer module. It
  did not deliver that: it serialized to a string and assigned `innerHTML`, so `@event`, `.prop` and
  `?bool` bindings ended up in the DOM as literal attributes. Both README quick-starts relied on it
  and both were broken — they rendered `<button @click="">Clicked 0 times</button>` and clicking did
  nothing. Both are fixed and verified in this release.
  
  Core drops from 2 801 B to 2 577 B gzipped, and a working app from 5 759 B to 5 588 B.
  
  `defaultRenderer` is no longer exported. If you were using it deliberately, the closest equivalent
  is `@verajs/renderer`, which is what every documented path already used.

### Patch Changes

- cbf56b2: Correct the published size figures and generate them from the build instead of maintaining them by
  hand. Every `~N KB gzip` claim in a package README is now produced by `scripts/sync-size-claims.mjs`
  from the actual `dist` bundle, and CI fails if any of them drifts.
- Updated dependencies [a6a6509]
- Updated dependencies [cbf56b2]
  - @verajs/inserts@0.1.3

## 0.1.2

### Patch Changes

- Fix a renderer crash, and ship the license text.
  
  **Renderer.** `ChildPart._clear()` could walk off the end of the child list and throw
  `Cannot read properties of null (reading 'nextSibling')`, aborting the render pass and leaving a
  half-updated DOM. `TextPart` upgrades to a `ChildPart` on its first non-primitive value, and it
  borrowed `this._text.nextSibling` as its exclusive end — a node owned by the *next* part, which
  that part removes when it upgrades and clears its own text. The upgrade now inserts its own end
  marker, so a part owns both anchors and `_end === null` means only "root part", which makes the
  `textContent = ''` fast path sound. The removal loop also stops at the end of the child list
  rather than throwing, so a broken invariant degrades into a missed removal.
  
  Triggered by several sibling child-expressions in one parent each toggling between a template and
  `''` — a shape any conditional-heavy template can reach. Costs 19 bytes gzipped and nothing
  measurable in the DOM benchmarks. Covered by `tests/renderer-sibling-parts.test.mjs`.
  
  **Licensing.** Every package now ships the MIT `LICENSE` text rather than only declaring `"MIT"`
  in its manifest, and `author` names a person.
- Updated dependencies
  - @verajs/inserts@0.1.2

## 0.1.1

### Patch Changes

- 5228f8d: Pin the canonical `git+https://` form of `repository.url`.
  
  npm normalizes this field on publish, and the registry compares the normalized
  value against the provenance statement's source repository — a mismatch is
  rejected with a 422. Carrying the normalized form in the manifest removes the
  dependency on auto-correction.
  
  This is also the first release published from GitHub Actions via npm Trusted
  Publishing, so these are the first `@verajs` tarballs to carry a provenance
  attestation.
- Updated dependencies [5228f8d]
  - @verajs/inserts@0.1.1
