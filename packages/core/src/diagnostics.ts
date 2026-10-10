/**
 * **Core's diagnostics, keyed by code — DEVELOPMENT ONLY.** Referenced only behind `__DEV__`, so production drops this
 * module whole and prints the shared short line (`diagnostic`, shared-utils): the subject and the link to
 * `verajs.dev/e/<code>`. `scripts/sync-diagnostics.mjs` publishes this table as `packages/core/diagnostics.json`
 * — the docs pages — and `tests/diagnostics-tables.test.mjs` holds the codes raised and the entries together.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /* ── what the app's own code threw, forwarded (printed beside the error; production prints the bare code) ── */
  'hook-threw': () => [
    'threw; its error is printed beside this line, and the other hooks still ran.',
    "Fix the hook, or wire an 'error' insert to handle what hooks throw: `wire([{ on: 'error', fn: (error, element) => … }])`.",
  ],
  'cleanup-threw': () => [
    'threw (the function a hook returned, not the hook itself); its error is printed beside this line, and the rest of the teardown ran.',
    "Fix the cleanup, or wire an 'error' insert to handle what hooks throw.",
  ],
  /* ── misused APIs (thrown, development only — `misuse()`) ── */
  'untrack-not-function': (received) => [
    `expected a function and received ${received}.`,
    'It runs the function without subscribing — `untrack(() => state.a)`, not `untrack(state.a)`, which reads the property before untrack can do anything about it.',
  ],
  'init-not-element': (received) => [
    `expected a component element and received ${received}.`,
    'Call it in connectedCallback with the component itself — `init(this)`.',
  ],
  'scheduler-not-function': (received) => [
    `expected a function and received ${received}.`,
    'It receives the flush and decides when to run it — `microtask` (the default) and `frameBudget` are exported for that.',
  ],
  'allow-loop-not-element': (received) => [
    `expected a component element and received ${received}.`,
    'Pass the element whose loop is intentional — `allowRenderLoop(this)` inside the component.',
  ],
  'store-not-object': (received) => [`expected an object and received ${received}.`, 'To hold one value, use ref(value).'],
  'store-refused': (operation, why) => [
    `this store's source object refused the ${operation} — ${why}.`,
    'A store proxies the object it was given and cannot override what JavaScript declines. Pass a mutable object to createStore, or keep this one outside the store and read it directly.',
  ],
  /* ── development warnings (`diagnostic()`) ── */
  'async-callback': () => [
    'returned a promise — an async callback runs, but it cannot return a cleanup, and what it awaits may arrive after the component re-ran or was removed.',
    'To cancel it, write the effect as a plain function that starts the async work and returns a cleanup that stops it — for a fetch, `const c = new AbortController(); load(c.signal); return () => c.abort();`.',
  ],
  'setup-uncommitted': (hooks) => [
    `registered ${hooks} hook(s) but its setup was never committed, so none of them will ever run.`,
    'init() opens the setup and one of these closes it: `render(() => html`…`)` for a component with markup, `mount();` for one with none.',
  ],
  'init-twice': (hooks) => [
    `called init() twice in one setup, so the ${hooks} hook(s) registered since the first call were discarded and will never run.`,
    'init() starts a fresh generation of hooks — which is what makes it safe when a component reconnects — so anything registered before a second call is dropped. Call init() once, then register hooks, then render() or mount().',
  ],
  'unwired-directives': (attribute) => [
    `renders \`${attribute}\`, but no directives engine is wired, so that attribute does nothing.`,
    "`@verajs/directives` is NOT PUBLISHED YET — `npm i` will 404 — so if this markup came from a demo, remove the attribute or write the behavior yourself for now. When it ships, it is wired once at your app entry: `import { directives } from '@verajs/directives'; wire([renderer, directives]);`",
  ],
  'nested-flush': () => [
    'flush() inside a running flush (a hook, a render, or an event one of them fired) does nothing: the DOM updates when this flush ends — nothing failed.',
    'To read the DOM a render made, read it in useLayoutEffect, which runs right after the render.',
  ],
  'render-loop': (frames) => [
    `has re-run for ${frames} consecutive frames because it writes state it also reads — this will keep running for as long as the page is open.`,
    'Guard the write (`if (next !== state.x) state.x = next`), or move it out of the pass. More than one hook may be involved: a template reading what an effect writes is caught here too. If it is deliberate — an animation driven by one store write per frame — silence it with `allowRenderLoop(this)` from @verajs/core, or drive it with `requestAnimationFrame`.',
  ],
  'bare-render': () => [
    'render() was called with no template. That works — the setup is committed and the hooks run, exactly as with a template — but mount() is the name for it, and says so at the call site.',
    "`import { mount } from '@verajs/core'; mount();`",
  ],
  'unwired-styles': () => [
    'declares `static styles`, but nothing is adopting them, so it renders unstyled.',
    "Style adoption lives in `@verajs/styles`. Wire it once at your app entry: `import { styles } from '@verajs/styles'; wire([styles]);`",
  ],
  'no-collections': () => [
    'is handed back as it is — it works, but nothing that reads it updates when it changes.',
    "Make it reactive: `import { collections } from '@verajs/store/collections'` and add it to your `wire([…])` call.",
  ],
  'no-renderer': () => [
    'no renderer is wired, so nothing will appear.',
    "Wire one once, at your app entry: `import { renderer } from '@verajs/renderer'; wire([renderer]);`",
  ],
  'sync-loop': () => [
    're-entered 50 times and was stopped — it writes state it also reads, and it runs synchronously on every change, ' +
      'so an unguarded write feeds itself.',
    'Guard the write (`if (next !== state.x) state.x = next`), or use `useEffect`, which coalesces.',
  ],
  'no-owner': () => [
    `there is no component being set up. Hooks, \`render()\` and \`mount()\` belong to a component's setup, which runs ` +
      `synchronously from \`init(this)\` and ends at the first \`await\` — so after an \`await\` in setup, or later in ` +
      `a handler, there is no component to attach them to.`,
    'Setup ends at the first `render()` — to change what is shown later, write to a store, never render() again. ' +
      'Await BEFORE `init(this)`; or create hooks and call `render()` before the first `await` and write what you ' +
      'await into state; or pass the element explicitly: `useEffect(fn, this)`.',
  ],
};
