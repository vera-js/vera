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
  /* ── the setup (R1, 2026-10-10) ── */
  'setup-rejected': () => [
    'its async setup rejected, so nothing it registered runs; the error is printed beside this line.',
    "Catch inside the setup to render a fallback, or wire an 'error' insert to handle it: `wire([{ on: 'error', fn: (error, element) => … }])`.",
  ],
  'setup-returned-value': (kind) => [
    `its setup returned ${kind}, not a render function, so it rendered once and will never update.`,
    'Return a render function — `return () => html`…`;` — the setup runs once, the render on every change.',
  ],
  'shadow-option': (value, platform) => [
    platform
      ? `\`shadow: ${value}\` names a mode the platform does not have, so attachShadow refuses it (it throws, in every build).`
      : `\`shadow: ${value}\` is not a root this element can have, so it renders into its light DOM.`,
    "Use 'open', 'closed', false (light DOM) or a ShadowRootInit such as { mode: 'open', delegatesFocus: true }.",
  ],
  'foreign-nodes-option': (value) => [
    `\`foreignNodes: ${value}\` is not a setting, so the template owns this root (the default, 'drop').`,
    "Use 'drop' (the template owns the root: foreign nodes are cleared when the template changes) or 'preserve' (the root keeps them where they are).",
  ],
  'setup-near-miss': (name) => [
    `it has a \`${name}\` method and no \`setup\`, so init found nothing to run.`,
    'Name the method `setup` — init(this) calls `this.setup(host)` and renders the function it returns.',
  ],
  'untrack-not-function': (received) => [
    `expected a function and received ${received}.`,
    'It runs the function without subscribing — `untrack(() => state.a)`, not `untrack(state.a)`, which reads the property before untrack can do anything about it.',
  ],
  'init-not-element': (received) => [
    `expected a component element and received ${received}.`,
    'Call it in connectedCallback with the component itself — `init(this)`.',
  ],
  'priority-not-finite': (received) => [
    `the priority must be a finite number, and ${received} is not — the hook was not registered (in production too, silently).`,
    'Lower runs first: 25 runs before the render, 50 is the render, 60 useLayoutEffect, 75 useEffect. A priority read from config with `parseInt` is NaN when the value is missing.',
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
    `there is no component being set up. Hooks belong to a component's setup — the function \`init\` calls, ` +
      `synchronously — so after it returns, after an \`await\` inside it, or later in a handler, there is no component ` +
      `to attach them to.`,
    'To change what is shown later, write to a store. Await BEFORE `init(...)`, or inside an async setup with its ' +
      'hooks before the first `await`; or pass the element explicitly: `useEffect(fn, this)`.',
  ],
  'init-options': () => [
    "`init`'s second argument is the SETUP, a function, and this is an options object (the old `init(this, { mode })`): " +
      'it is ignored, in every build, so this component sets up with no shadow root.',
    "Options travel with the host: `init({ host: this, shadow: 'open' }, setup)`.",
  ],
};
