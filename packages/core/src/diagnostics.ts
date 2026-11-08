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
  /* ── the setup (2026-10-10) ── */
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
  'option-claimed-twice': (key, first, second) => [
    `\`${key}\` is claimed by ${first} and by ${second}, so both are handed it and either may read it.`,
    'Wire only one module that takes this option, or ask the module to rename its key.',
  ],
  'foreign-nodes-option': (value) => [
    `\`foreignNodes: ${value}\` is not a setting, so the template owns this root (the default, 'drop').`,
    "Use 'drop' (the template owns the root: foreign nodes are cleared when the template changes) or 'preserve' (the root keeps them where they are).",
  ],
  'setup-near-miss': (name) => [
    `it has a \`${name}\` method and no \`setup\`, so init found nothing to run.`,
    'Name the method `setup` — init(this) calls `this.setup(host)` and renders the function it returns.',
  ],
  'persist-not-seconds': (received) => [
    `was given persist: ${received}, which is not a finite number of seconds, so it is torn down at removal.`,
    'Pass the seconds to keep it paused after a removal — init({ host: this, persist: 30 }) — or leave persist out.',
  ],
  'setup-outlived-removal': (seconds) => [
    `was removed while its async setup was still running, and the setup had not settled ${seconds} s later — so it was torn down without ever drawing.`,
    "If the component may come back later, let the setup finish faster (pass its abort signal to fetch), or keep it with persist: seconds.",
  ],
  'lists-unwired': () => [
    'returned templates, but no list module is wired, so its rows are matched by position: reorder the array and a row\'s DOM state (a focused input, a typed value) and its component state show against another item.',
    'Wire the automatic lists once at your entry — wire([renderer, lists]) with lists from @verajs/renderer/keyed — or key each row with keyed(key, row). To match by position on purpose (rows with no state), map a plain copy: [...state.rows].map(…).',
  ],
  'deep-not-boolean': (received) => [
    `was given deep: ${received}, which is not true or false, so it used its default.`,
    'Pass a boolean: signal(value, { deep: true }).',
  ],
  'computed-not-function': (received) => [
    `expected a function to derive the value from, and received ${received}.`,
    'Pass the expression as a function — computed(() => a + b), not computed(a + b).',
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
    'Lower runs first: 25 runs before the render, 50 is the render, 60 a layout effect, 75 an effect. A priority read from config with `parseInt` is NaN when the value is missing.',
  ],
  'scheduler-not-function': (received) => [
    `expected a function and received ${received}.`,
    'It receives the flush and decides when to run it — `microtask` (the default) and `frameBudget` are exported for that.',
  ],
  'allow-loop-not-element': (received) => [
    `expected a component element and received ${received}.`,
    'Pass the element whose loop is intentional — `allowRenderLoop(this)` inside the component.',
  ],
  'store-not-object': (received) => [`expected an object and received ${received}.`, 'To hold one value, use signal(value).'],
  'store-refused': (operation, why) => [
    `this store's source object refused the ${operation} — ${why}.`,
    'A store proxies the object it was given and cannot override what JavaScript declines. Pass a mutable object to createStore, or keep this one outside the store and read it directly.',
  ],
  /* ── development warnings (`diagnostic()`) ── */
  'async-callback': () => [
    'returned a promise — an async callback runs, but it cannot return a cleanup, and what it awaits may arrive after the component re-ran or was removed.',
    'To cancel it, write the effect as a plain function that starts the async work and returns a cleanup that stops it — for a fetch, `const c = new AbortController(); load(c.signal); return () => c.abort();`.',
  ],
  'built-in-host-unwired': () => [
    'init() was given a built-in element (a div, a section…), which has no lifecycle core can hear: it is never set up again when re-attached and never released when removed.',
    "Use a custom element and call init(this) in its connectedCallback — or, to keep the built-in element, wire its lifecycle: wire([renderer, nativeElements]) from '@verajs/renderer/native-elements'.",
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
    'To read the DOM a render made, read it in an effect with `{ timing: \'layout\' }`, which runs right after the render.',
  ],
  'render-loop': (frames) => [
    `has re-run for ${frames} consecutive frames because it writes state it also reads — this will keep running for as long as the page is open.`,
    'Guard the write (`if (next !== state.x) state.x = next`), or move it out of the pass. More than one hook may be involved: a template reading what an effect writes is caught here too. If it is deliberate — an animation driven by one store write per frame — silence it with `allowRenderLoop(this)` from @verajs/core, or drive it with `requestAnimationFrame`.',
  ],
  'unwired-styles': () => [
    'declares `static styles`, but nothing is adopting them, so it renders unstyled.',
    "Style adoption lives in `@verajs/styles`. Wire it once at your app entry: `import { styles } from '@verajs/styles'; wire([styles]);`",
  ],
  'store-defaults-twice': () => [
    "core's own store handlers were handed to the store door twice, which means two copies of core's traps module were bundled into one copy of core.",
    'This is a build error: check that the bundler resolves core to one module graph.',
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
    'Guard the write (`if (next !== state.x) state.x = next`), or use a plain `effect`, which coalesces.',
  ],
  'no-owner': () => [
    `there is no component being set up. Hooks belong to a component's setup — the function \`init\` calls, ` +
      `synchronously — so after it returns, after an \`await\` inside it, or later in a handler, there is no component ` +
      `to attach them to.`,
    'Called after an `await` in an async setup? Call effect() BEFORE the first `await`, and return the render after it. ' +
      'To change what is shown later, write to a store. A builder\'s own primitive names its owner: `effect(fn, { owner })`.',
  ],
  'define-tag': (received) => [
    `expected a custom element name — a string with a hyphen, not at the start — and received ${received}.`,
    "Name it the way the platform requires: `define('x-card', setup)` or `define({ tag: 'x-card' }, setup)`.",
  ],
  'define-setup': (received) => [
    `the second argument is the SETUP, a function, and received ${received}.`,
    'Pass the setup after the tag or the options: `define(\'x-card\', (host) => () => html`…`)`.',
  ],
  'define-twice': (tag) => [
    `<${tag}> is already defined; the platform refuses a second definition of a tag and throws next.`,
    'Define each tag once, at module level. A live swap of a component while developing needs the development swap module, wired before the first define.',
  ],
  'define-method-ignored': (name) => [
    `\`${name}\` is core's own on a define-made class, so this one is never installed (in any build).`,
    name === 'constructor'
      ? 'A setup is where per-instance work goes: `define(tag, (host) => { … })`.'
      : 'Put connect-time work in the setup; for work on removal, a `disconnectedCallback` in methods runs as the teardown hook.',
  ],
  'define-method-not-function': () => [
    'is not a function, so it is installed as a plain value shared by every instance — and a getter ran ONCE, here.',
    'Methods are functions; a value that changes per element is a prop (`props: { name: default }`).',
  ],
  'define-method-adopted': () => [
    'an `adoptedCallback` costs every element of this tag its creation (measured +7.4% on create10k), and it is installed.',
    'Keep it only if moving elements between documents needs it.',
  ],
  'define-method-unobserved': () => [
    'never fires: the class observes no attributes, and it is installed anyway.',
    "Declare them: `define({ tag, attributes: ['label'] }, …)` — each then arrives as a prop.",
  ],
  'define-shadows': (name) => [
    `replaces the platform's \`${name}\` for every user of these elements — scripts, libraries and the browser's own callers — and it is installed.`,
    'Give it a name of its own, unless replacing the platform member is the point.',
  ],
  'define-props-not-object': (received) => [
    `expected an object of names and their defaults and received ${received}, so no prop is declared.`,
    "Name each prop with its default: `props: { heading: '', items: [] }`.",
  ],
  'define-prop-method': (name) => [
    `\`${name}\` is also a method, and the prop wins (it is installed after the methods), in every build.`,
    'Give the method or the prop another name.',
  ],
  'define-prop-shared-default': () => [
    'this default is an object that cannot be copied per element (a Set, a Map, a class instance), so EVERY element of the tag shares this one — a change through one shows in all.',
    'Declare it `null` and create it in the setup (`props: { selected: null }`, then `host.selected = new Set()`), or pass it in; arrays and plain objects are copied per element.',
  ],
  'define-attributes': (received) => [
    `expected an array of attribute names and received ${received}.`,
    "List them: `attributes: ['label', 'data-count']` — each arrives as a prop (`label`, `dataCount`).",
  ],
  'define-attribute-type': (prop, type) => [
    `shares the prop \`${prop}\`, whose default is a ${type} — and the attribute arrives as a STRING, so the prop changes type the moment it appears.`,
    'Give the prop a string (or null) default, and convert in the render; or keep the attribute and the prop under different names.',
  ],
  'define-attribute-reflected': (prop) => [
    `observes an attribute whose prop, \`${prop}\`, is one the platform's element already REFLECTS — this tag's accessor replaces it, so setting \`el.${prop}\` no longer does what the platform's does (it no longer writes the attribute).`,
    'Observe it only if the component owns that attribute; otherwise read it in the render with `host.getAttribute(…)`.',
  ],
  'init-options': () => [
    "`init`'s second argument is the SETUP, a function, and this is an options object (the old `init(this, { mode })`): " +
      'it is ignored, in every build, so this component sets up with no shadow root.',
    "Options travel with the host: `init({ host: this, shadow: 'open' }, setup)`.",
  ],
};
