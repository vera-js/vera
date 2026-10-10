/**
 * **Every sentence in the docs that promises a diagnostic is accounted for** — it cites the code that keeps the
 * promise, or it says why it does not have one yet.
 *
 * The class this exists for (found 2026-10-08): the core README and llms.txt promised a self-feeding `useSyncEffect`
 * is "stopped and named at depth 50", and nothing did that — the rebuild had removed the guard and every suite stayed
 * green, because prose is the half no recipe or import check reaches. A one-time pass over every such sentence
 * (2026-10-09) found more of the same: a promised warning with no code (unwired `static styles`), and promises whose
 * code had moved under them (a warning said to be development-only that every build prints; a late hook said to be
 * "ignored with a console warning" that now throws).
 *
 * So each promise sentence — found by PATTERN below, in the files the recipes suite executes — is keyed by its file and
 * a hash of its text, and must appear in CLAIMS with one of:
 * - a CODE: it must exist in a package's generated `diagnostics.json`, and some test must assert it — a code no test
 *   names is a promise nothing checks;
 * - PENDING: the package has not moved its messages to codes yet. Verified by hand when the entry was written. This
 *   list only ever SHRINKS (`PENDING_MAX`) — it is the code-system migration's to-do list, not a place to park new
 *   promises;
 * - `pinned by tests/<file>: …` — a promise of BEHAVIOR, not of a message (an error routed through the `'error'`
 *   chain, a report's own text): no code can keep it, so the named test does, and that file must exist;
 * - a reason starting `not a promise:` — the pattern matched a sentence that promises nothing (it says there is NO
 *   warning, or names one in passing).
 *
 * A new or reworded sentence fails until it is entered — deliberately: writing "development warns" is the moment to
 * check that something does. An entry whose sentence is gone fails too, so the list stays exact.
 *
 * To see the current sentences with their keys: `VERA_CLAIMS_PRINT=1 node --test tests/docs-diagnostic-claims.test.mjs`
 * (`VERA_CLAIMS_PRINT=full` for whole sentences).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (file) => readFileSync(root + file, 'utf8');

/** The recipes suite's set: what a reader copies from. */
const FILES = ['README.md', 'llms.txt', ...globSync('packages/*/README.md', { cwd: root }).sort()];

/**
 * A promise of a message. Deliberately BROAD: an anchored first version (subject + verb) found 47 sentences and missed
 * 55 real promises ("`render()` warns once in development", "the warning names the path") — a narrow pattern fails
 * unsafe, so the false positives are paid for below with reasons instead. A sentence citing `verajs.dev/e/` promises a
 * page — it matches too (2026-10-09), and is pinned by the test that holds the pages' content.
 */
const PATTERN =
  /\b(?:warns?|warned|warning|says so|is named|names (?:it|the|both|which|any|one)|refused by name|reported|reports it|development (?:only )?(?:says|names|warns|throws|reports|catches|flags|tells)|(?:vera|it|the (?:framework|renderer|runtime|engine|router|compiler))\s+(?:names?|reports?|throws a \w*Error|refuses)|is (?:refused by name|said once)|names the (?:mistake|cause|binding|component|attribute)|give every line a code)\b|verajs\.dev\/e\//i;

/** Sentences, block-aware: a blank line, a heading or a table row ends a block, and code fences are not prose. */
const sentences = (text) =>
  text
    .replace(/```[\s\S]*?```/g, '\n\n')
    .split(/\n\s*\n|\n(?=#)|\n(?=\|)/)
    .map((block) => block.replace(/\s*\n\s*/g, ' '))
    .flatMap((block) => block.split(/(?<=[.!?])\s+(?=[A-Z`*(])/))
    .map((sentence) => sentence.trim());

/** A size marker's number moves with every size regeneration; the promise does not. */
const normalize = (sentence) => sentence.replace(/<!--size:([^>]*)-->[\s\S]*?<!--\/size:\1-->/g, '<size>').replace(/\s+/g, ' ');
const key = (file, sentence) => `${file}#${createHash('sha256').update(normalize(sentence)).digest('hex').slice(0, 10)}`;

const found = new Map();
for (const file of FILES)
  for (const sentence of sentences(read(file)))
    if (PATTERN.test(sentence)) found.set(key(file, sentence), sentence);

const PENDING = 'pending the code-system migration';
/** The pending list's size when it was written; lower it as packages migrate, never raise it. */
const PENDING_MAX = 8;

/** key → code | PENDING | 'not a promise: …'. The excerpt after `//` is for the reader; the key is the identity. */
const CLAIMS = new Map([
  ['llms.txt#304378b23d', 'pinned by tests/jsx-coded-errors.test.mjs: the production compiler says exactly position + docs link'], // **On this map a compile error names its position and its code** — `app.jsx:1:15 — https://verajs.dev/e/…`
  ['llms.txt#11ecc1a63b', 'jsx-uncontrolled'], // While developing, map `@verajs/jsx` to …/dist/development/vera-jsx-standalone.js instead
  ['llms.txt#ce53ba9a2a', 'pinned by tests/diagnostics-through-tables.test.mjs: the migrated list and the shrink-only NOT_YET list — the sentence names what is coded; when NOT_YET empties it can say every line'], // Core, styles, the renderer and the router also give every line a code …
  ['packages/core/README.md#ce53ba9a2a', 'pinned by tests/diagnostics-through-tables.test.mjs: the migrated list and the shrink-only NOT_YET list — the sentence names what is coded; when NOT_YET empties it can say every line'], // the same sentence
  ['llms.txt#1787f0438b', 'pinned by tests/diagnostics-docs-pages.test.mjs: the three production forms and the one docs address every code is explained at'], // Production prints a short line instead — the subject and a link …
  ['llms.txt#abc9affc7d', 'pinned by tests/diagnostics-docs-pages.test.mjs: every code has a page to generate at that address (the hosting is the docs-site release item)'], // Whichever form you hold, the full explanation of a code is at …
  ['packages/core/README.md#1787f0438b', 'pinned by tests/diagnostics-docs-pages.test.mjs: the three production forms and the one docs address every code is explained at'], // Production prints a short line instead …
  ['packages/core/README.md#abc9affc7d', 'pinned by tests/diagnostics-docs-pages.test.mjs: every code has a page to generate at that address (the hosting is the docs-site release item)'], // Whichever form you hold, the full explanation of a code is at …
  ['README.md#bfb75ca50a', 'no-renderer'], // `@verajs/core` ships **no renderer of its own** — `render()` without one warns (in every b
  ['README.md#b0878705a3', 'slots-unwired'], // It is <!--size:module.renderer-slots.kb-->4.08 KB<!--/size:module.renderer-slots.kb--> gzi
  ['llms.txt#460739a32e', 'no-renderer'], // **Core ships no renderer.** `render()` with none registered paints nothing and warns once 
  ['llms.txt#279a321f77', 'no-renderer'], // **Order matters.** A component that defines itself before `wire([renderer])` renders with 
  ['llms.txt#b927ee73a9', 'bare-render'], // Calling `render()` bare still works and warns. |
  ['llms.txt#2f0d102cd1', 'nested-flush'], // Inside a running flush (a hook, a render, an event one fired) it does nothing; the DOM upd
  ['llms.txt#039251dcd1', 'sync-loop'], // Development stops and names the recursion at depth 50.
  ['llms.txt#bef8ab79bd', 'render-loop'], // Development **warns without stopping it** after 50 consecutive held frames, naming the hoo
  ['llms.txt#01566eba01', 'render-loop'], // | `allowRenderLoop` | `(element) => void` | Marks a component's self-feeding loop as delib
  ['llms.txt#e6ce0bc198', 'wrong-namespace'], // It stays silent where the content is correct: inside `<foreignObject>`, `<desc>` and `<tit
  ['llms.txt#18c739df33', 'wrong-namespace'], // A HAND-WRITTEN template without the module wired is the same story: ``Frame(html`<path/>`)
  ['llms.txt#7e56270521', 'no-scope'], // **Light DOM:** hoisted to the document once per class, inside `@scope (tag-name) { … }`, w
  ['llms.txt#bc2964b69a', 'unwired-styles'], // Omit the wiring and a component with `static styles` renders unstyled — core warns once, i
  ['llms.txt#08c76e5a7f', 'slot-attributes'], // Development builds warn, naming the attribute. - A node added AFTER the first render joins
  ['llms.txt#e425a4f952', 'not a promise: points back to the insertBefore warning, which is entered where it is promised'], // What light has fewer of is POSITIONS you can name (a distributed child is no longer a dire
  ['llms.txt#fceb605423', 'not a promise: says no warning is possible'], // Wire `slots` on the SERVER too: without it the server states no light tree, and every comp
  ['llms.txt#807497a5bc', 'not a promise: says there is no warning'], // No error, no warning, no accessible name.
  ['llms.txt#a9a4b2f023', 'hydration-fallback'], // An attribute is READ and written only on a difference (a wrong one is repaired, a right on
  ['llms.txt#c11efabddf', 'event-name-typo'], // Every other prop is permissive (every element accepts it), so `key` and bare props type-ch
  ['llms.txt#ecc227eaa1', 'jsx-uncontrolled'], // `onWarning` hears what compiles but is probably a mistake (`file:line:col — message (code)`; …
  ['llms.txt#0ddf816771', 'not a promise: attribute carve-outs, no diagnostic'], // Carve-outs, both derivations rather than a list: a name that cannot be a JS identifier (`d
  ['llms.txt#006492a483', 'router-relative-param'], // The one surprise — a relative word from a path ENDING in a param replaces it (`navigate('e
  ['llms.txt#f58d360591', 'router-no-outlet'], // If the parent renders no matching outlet the route does not apply (and warns in developmen
  ['llms.txt#51b7fd8199', 'router-href-base'], // **Write hrefs relative or with the base** — a route-space `href="/users"` works when click
  ['llms.txt#bb996b85fd', 'motion-property-at-top-level'], // A property written at the top level, or a setting written inside `keyframes`, is refused b
  ['llms.txt#17b8203f63', 'motion-pointer-with-scroll'], // `inertia` composes (the mouse-follow feel), and so does `play` — a pointer-sourced play sw
  ['llms.txt#f4c0cf1abe', 'motion-function-threw'], // The attribute NAMES a function and never contains one, `tick` may be the whole animation (
  ['llms.txt#ed7c5e3aed', 'pinned by tests/motion-ssr-diagnostics.test.mjs: the script is RUN and every line is motion\'s one format, per build'], // It now also emits one inline `<script data-vm-diagnostics>` … one line each, in motion's one format
  ['llms.txt#ad6b32ff47', 'motion-vocabulary-replaced'], // `motionExtension` is also how a module adds animatable PROPERTIES (`{ key, category, … }`)
  ['llms.txt#52f6fe43e7', PENDING], // Keep a FEED's depth out of `data-vd-query` — an accumulating view's middle pages are DOM, 
  ['llms.txt#df3b9dfe11', 'not a promise: attribute carve-outs, no diagnostic'], // The exceptions are derivations, not a vocabulary: names that cannot be JS identifiers (`da
  ['llms.txt#347dad05df', 'attribute-value'], // On an HTML tag, `rows={data}` is still an attribute, and the renderer names any non-primit
  ['llms.txt#461d362f95', 'boolean-child'], // A **hand-written** `html` template has the identical hazard with no compiler in front of i
  ['llms.txt#c23d8dc6f5', 'tag-inner-html'], // **`key` and `ref` work on a runtime `tag` component exactly as on a written element** (`<H
  ['llms.txt#8a42e4218c', 'no-renderer'], // Defining a component before `wire([renderer])` → with nothing on the `'render'` chain, `re
  ['llms.txt#b9de104cbe', 'wire-replaced'], // Registering at an **occupied** priority replaces that entry (this is how a renderer is swa
  ['llms.txt#7cdcce9c98', 'setup-uncommitted'], // Development warns if neither happens, and names both. 7.
  ['llms.txt#bf52103f92', 'autoloader-not-defined'], // An autoloaded file that loads and defines a different tag than its name → reported via `ve
  ['llms.txt#7fae901481', 'boolean-child'], // Development names it.
  ['llms.txt#9d82b4cb6b', 'attribute-value'], // Development names any non-primitive that reaches an attribute sink. 13.
  ['llms.txt#ebf4968a15', 'upgrade-clobber'], // For an element that never calls `init()`, nothing drains the record either, so the clobber
  ['packages/autoloader/README.md#2c0b84874a', 'loader-url-refused'], // Discovery catches the throw, reports it once and moves on, so a hostile attribute costs a 
  ['packages/core/README.md#bf064fe7d3', 'no-collections'], // Without it core says so the first time one is read.
  ['packages/core/README.md#7508f63a9f', 'not a promise: says there is no warning'], // There is no warning for this.
  ['packages/core/README.md#0182a20510', 'not a promise: explains why there is no warning'], // A `Date` read to format it is far more common than a `Date` read to mutate it, so a warnin
  ['packages/core/README.md#1881b70b2d', 'store-refused'], // In development the error names the rule that refused — *"the object is frozen, so `n` cann
  ['packages/core/README.md#477de3b835', 'render-loop'], // So development **warns and does not stop it**, after 50 consecutive frames in which the pa
  ['packages/core/README.md#aad1748cf2', 'render-loop'], // `allowRenderLoop(element)` silences the warning for that component, and is a no-op in prod
  ['packages/core/README.md#a7abca6089', 'render-loop'], // | An update loop throws "Maximum update depth exceeded" | It never freezes the page: a sel
  ['packages/core/README.md#922a99a86a', 'nested-flush'], // Inside a running flush (a hook, a render, or an event one of them fired) it does nothing —
  ['packages/core/README.md#37e87470fe', 'setup-uncommitted'], // Hooks that are never committed never run: no error, no render, an effect that simply does 
  ['packages/core/README.md#e8129f5cea', 'not a promise: says nothing can warn'], // Without the guard the component still renders, because a custom-element reaction that thro
  ['packages/core/README.md#b9d5123713', 'not a promise: says there is no warning'], // **Every ID-based ARIA relationship resolves within a single tree, so a shadow root breaks 
  ['packages/core/README.md#10b78df7ea', 'upgrade-clobber'], // An element that never calls `init()` (a plain custom element a vera template binds) keeps 
  ['packages/directives/README.md#bc8584566e', PENDING], // A feed shares a POSITION — an item fragment (`#id`), or a server cursor the establishment 
  ['packages/directives/README.md#4d20f0c981', 'motion-property-at-top-level'], // Put one in the wrong half and it is refused by name with the move spelled out, in both dir
  ['packages/directives/README.md#c54e2c0f10', 'motion-vocabulary-replaced'], // Keys **replace** with a `motion-vocabulary-replaced` warning; inserts (`preset`, `easing`,
  ['packages/inserts/README.md#a56509b716', 'not a promise: a return-value protocol, not a message'], // An insert that wants to change what core does — rather than merely watch — says so through
  ['packages/inserts/README.md#3eed974ae8', 'not a promise: error routing of a throwing hook, not a message'], // **Nothing catches it, and that is deliberate — but it is not the same as a hook.** A `useE
  ['packages/inserts/README.md#776c11547b', 'not a promise: what an insert may do, not a message'], // `'init'` is where per-element setup hooks in, so one throwing module keeps the rest from i
  ['packages/jsx/README.md#a886d0d774', 'jsx-uncontrolled'], // | `onWarning` | the plugin: Vite's own `warn` | `(message) => …`, … as `file:line:col — message (code)`.
  ['packages/jsx/README.md#5a8aa12e19', 'jsx-helper-missing'], // If the renderer's helper files are missing from beside it, the error names the file, where
  ['packages/jsx/README.md#5f9c8908e7', 'jsx-circular-import'], // **One thing it cannot do is a circular import** — it is reported, naming the loop; the Vit
  ['packages/jsx/README.md#039bf7676f', 'jsx-uncontrolled'], // | `value` / `checked` | `!value=` / `!checked=` | controlled, as React's are: compared wit
  ['packages/jsx/README.md#549f696ea7', 'not a promise: attribute carve-outs, no diagnostic'], // Two derivations carve out the attributes: a **name that cannot be a JS identifier** (`data
  ['packages/jsx/README.md#63768c1671', 'boolean-child'], // A **hand-written** template has the same hazard and no compiler to fix it, so `@verajs/ren
  ['packages/jsx/README.md#83e11d96f6', 'boolean-child'], // A hand-written template renders the word **"false"** there, matching lit — and `@verajs/re
  ['packages/jsx/README.md#c448649b3c', 'boolean-child'], // Development names each one, and `{rows.filter((r) => r.ok).map(…)}` is the fix.
  ['packages/jsx/README.md#2331fe9023', 'not a promise: design rationale'], // **This is where vera and React deliberately part**, and the reason is measured: React filt
  ['packages/jsx/README.md#47c79cbe8e', 'not a promise: a heading; the sentences under it are entered'], // ## What it refuses, and where
  ['packages/jsx/README.md#b7967e9cd2', 'pinned by tests/jsx-coded-errors.test.mjs: every refusal in the list, position first and its code, in each build'], // Every mistake below is reported with the file, line and column and its code — the full explanation
  ['packages/jsx/README.md#1254da39bf', 'pinned by tests/jsx-coded-errors.test.mjs: production is exactly position + docs link, and the node build says the sentence'], // **A buildless page on the `.min.js` loader gets the position and the code**
  ['packages/jsx/README.md#724b1c3ce0', 'not a promise: says the bundler reports it, not vera'], // The cost is that a genuinely unclosed element (`<p>x` with no `</p>`) reaches your bundler
  ['packages/jsx/README.md#f816cb75b4', 'event-name-typo'], // TypeScript cannot refuse it beside the permissive props, so the renderer names it instead 
  ['packages/jsx/README.md#0b7d099fba', 'not a promise: TypeScript names the misspelling, not a vera message'], // Custom event names, including ones that extend a real event (`onChanged`), are left alone.
  ['packages/renderer/README.md#2b44911726', 'no-renderer'], // Without it, core has no renderer at all: `render()` warns once (in every build) and puts n
  ['packages/renderer/README.md#24226b7ae7', 'not-a-listener'], // Anything else that cannot listen — a string, a number, an object with no `handleEvent` — i
  ['packages/renderer/README.md#c3769d8d67', 'select-multiple'], // Development says so.
  ['packages/renderer/README.md#a75ef39c09', 'boolean-child'], // | `true`, `false` | as text — **and development says so**; see below |
  ['packages/renderer/README.md#53f8bf9cf7', 'boolean-child'], // The value is legitimate and nothing throws, so **development names it** at the binding rat
  ['packages/renderer/README.md#bc33e32558', 'boolean-child'], // That is the **one** value semantic on which JSX and a hand-written template differ, and th
  ['packages/renderer/README.md#084ad57ff0', 'not a promise: a heading; the next sentence is entered'], // ### A template committed into the wrong namespace is named
  ['packages/renderer/README.md#e10a13490e', 'wrong-namespace'], // Without it, **development names it**, once per host namespace, host name, content namespac
  ['packages/renderer/README.md#bee0271268', 'wrong-namespace'], // It is silent where the content is correct: inside `<foreignObject>`, `<desc>` and `<title>
  ['packages/renderer/README.md#af7465ba0c', 'not a promise: a measurement'], // **Never mix it with `@verajs/renderer` in one app** — that loads two renderers with two te
  ['packages/renderer/README.md#f3d555ed7b', 'pinned by tests/renderer-profiler.test.mjs: the report\'s own text, not a diagnostic'], // `formatReport` says so when it observed nothing, because a zero report is otherwise indist
  ['packages/renderer/README.md#78e9e20a99', 'not a promise: error routing of a throwing claim (the ref rule), not a message'], // **`hold()` is not teardown** … A throwing `create`, `mount` or `unmount` is reported, never raised
  ['packages/renderer/README.md#bf5ee4fc44', 'not a promise: error routing of a throwing claim (the ref rule), not a message'], // Every throw is reported.
  ['packages/renderer/README.md#1b81f4a6ef', 'not a promise: error routing of a throwing claim (the ref rule), not a message'], // A claim whose `create` threw is dropped for that instance
  ['packages/renderer/README.md#0a3da5a8b5', 'late-template-module'], // - **`@verajs/jsx` wires it for you**, from every file it compiles — JSX cannot write `` sv
  ['packages/renderer/README.md#62e6dacab5', 'late-template-module'], // Development names it when it happens, but the rule is cheaper than the diagnostic: wire it
  ['packages/renderer/README.md#36df9b936f', 'not a promise: says no warning is possible'], // **Wire `slots` on the server too:** a server without it writes no light-tree statement, so
  ['packages/renderer/README.md#0ea1b3bb42', 'hydration-protocol'], // The light-tree statement carries a format number, so render and hydrate with matching rele
  ['packages/renderer/README.md#d30b698f07', 'hydration-unwired'], // The one case that can be: with slots wired, the server states every component host it rend
  ['packages/renderer/README.md#a7973b11a7', 'hydration-fallback'], // **A fallback warns in every build, naming the first place the two renders disagreed** — de
  ['packages/renderer/README.md#149cd7ec21', 'hydration-fallback'], // It is said once per kind of disagreement per hydration pass, so a list whose every row dis
  ['packages/renderer/README.md#53e2a71297', 'hydration-fallback'], // **A fallback costs one container, not the page.** Adoption is decided per container, so co
  ['packages/renderer/README.md#3c840615a5', 'hydration-fallback'], // Measured in `tests/hydrate-mismatch.test.mjs` — three containers, one mismatch, one warnin
  ['packages/renderer/README.md#731e71d32f', 'not a promise: history of the wording'], // Worth stating because the warning used to imply otherwise and sent the reader hunting for 
  ['packages/renderer/README.md#40e8320f1f', 'spread-unsafe-name'], // **A key that cannot be written into markup is skipped**, with a warning in development.
  ['packages/renderer/README.md#5a81e4d78c', 'upgrade-clobber'], // Elements that never call `init()` keep the development warning and the `declare` advice in
  ['packages/renderer/README.md#f8471d54c4', 'forged-template'], // Data shaped like a template (an API field an attacker turned into `{"strings": [...]}`, a 
  ['packages/renderer/README.md#9716e1f324', 'pinned by tests/api-misuse-sweep.test.mjs: a catalog of a dozen messages — every refusal it lists is thrown by the sweep, every warning has its own coded claim'], // **Development tells you; production pays nothing.** Misuse the renderer can see in a templ
  ['packages/renderer/README.md#5ae4ff86c0', 'tag-key'], // `key` never reaches the component: `@verajs/jsx` consumes it into `keyed(…)` for both spel
  ['packages/renderer/README.md#57d42dee7e', 'not a promise: a size'], // <!--size:tag.gzip-->2.19 KB<!--/size:tag.gzip--> gzipped, which includes `/spread` — the f
  ['packages/router/README.md#fa48cfe868', 'router-no-match'], // **A path that matches nothing does nothing, and development says so.** `navigate` returns 
  ['packages/router/README.md#7fc72a994a', 'router-no-match'], // The warning names the path.
  ['packages/router/README.md#d53c74196e', 'router-no-outlet'], // If the parent's template renders no matching outlet the route does not apply, and says so 
  ['packages/router/README.md#7b892d775b', 'router-no-outlet'], // Those levels fall back to searching inside the level above for a bare `<div view>`, and a 
  ['packages/router/README.md#f7348f4d9d', 'router-string-guard'], // Development warns when a guard returns a string.
  ['packages/router/README.md#5c763d362b', 'not a promise: history: what no longer warns'], // `navigate('login')` from `/shop/items` now goes to `/shop/login` rather than dead-ending w
  ['packages/router/README.md#12b42ba1c2', 'router-duplicate-name'], // Two routes claiming one name warn in development.
  ['packages/router/README.md#23c2747b14', 'router-navigate-threw'], // - **`navigate()` rejects**, so a caller that awaits it can handle the failure itself. - **
  ['packages/ssr/README.md#2f37875801', 'not a promise: says no warning is possible'], // **Wire `slots` on the client AND here:** without it this server writes no light-tree state
  ['packages/ssr/README.md#8e83430b17', 'hydration-fallback'], // An HTML minifier that strips comments removes them, and hydration then treats that compone
  ['packages/ssr/README.md#dc1c1f67b9', PENDING], // A `__proto__` key is skipped, and a read-only property is refused by name |
  ['packages/ssr/README.md#1894c72248', PENDING], // | `timeout` | how long `renderToStringAsync` waits on promises a component starts, in mill
  ['packages/ssr/README.md#17179b9838', PENDING], // When the budget runs out the render serves what it has and warns, in every build, naming t
  ['packages/ssr/README.md#07eca03e44', PENDING], // The warning names the component waiting and the child it waits on.
  ['packages/ssr/README.md#b7dd238da1', 'not a promise: says it prints no warning'], // That serves the component's state from before the wait, which is exactly what the browser 
  ['packages/ssr/README.md#1e3a0a07fa', PENDING], // **It only ever produces the component it was written for**: a copy of it on another tag is
  ['packages/ssr/README.md#777bd846a5', PENDING], // That is what stops a per-class sheet being emitted once per instance; the consequence is t
  ['packages/store/README.md#1bca1504c8', 'pinned by tests/computed.test.mjs: error routing through the \'error\' chain, not a message'], // An evaluation that throws is reported through the `'error'` insert rather than escaping, e
  ['packages/styles/README.md#48e9ab9c5a', 'unwired-styles'], // Forget the wiring and a component with `static styles` renders unstyled — development says
  ['packages/styles/README.md#ab7656278f', 'slotted-light'], // Development says so if a light component's sheet uses `::slotted()`.
  ['packages/styles/README.md#b5c13c2241', 'no-scope'], // Development says so, once.
  ['packages/styles/README.md#11305688d2', 'not a promise: the engine refuses, not vera'], // A constructed sheet can only be adopted by documents of its own window — the engine refuse
  ['packages/ui/README.md#01a97ce183', 'ui-defined-twice'], // Two library versions on one page warn instead of silently forking — and `@verajs/ui/elemen
]);

const codes = new Set(
  globSync('packages/*/diagnostics.json', { cwd: root }).flatMap((file) => JSON.parse(read(file)).entries.map((entry) => entry.code))
);
/** The motion spec's fixtures count: `motion-spec-corpus` asserts every code they list, in order. */
const testSources = [
  ...globSync('tests/*.test.mjs', { cwd: root }),
  ...globSync('tests/browser/*.test.js', { cwd: root }),
  ...globSync('docs/motion-spec/fixtures/*.json', { cwd: root }),
]
  .filter((file) => !file.endsWith('docs-diagnostic-claims.test.mjs'))
  .map(read)
  .join('\n');

if (process.env.VERA_CLAIMS_PRINT)
  for (const [k, sentence] of found) console.log(`  ['${k}', ${JSON.stringify(CLAIMS.get(k) ?? '?')}], // ${(process.env.VERA_CLAIMS_PRINT === 'full' ? sentence : sentence.slice(0, 110))}`);

test('the pattern still finds promises — a silent extractor would pass everything below', () => {
  assert.ok(found.size > 50, `found only ${found.size}`);
  assert.ok([...found.values()].some((s) => s.includes('static styles') && s.includes('renders unstyled')), 'the styles README promise that started the pass');
});

test('every promise sentence is entered — a new or reworded one is checked against the code before it lands', () => {
  const missing = [...found].filter(([k]) => !CLAIMS.has(k)).map(([k, s]) => `${k} — ${s.slice(0, 160)}`);
  assert.deepEqual(missing, [], 'enter each with its code, PENDING (only if its package has no codes yet) or "not a promise: why"');
});

test('every entry still has its sentence', () => {
  assert.deepEqual([...CLAIMS.keys()].filter((k) => !found.has(k)), [], 'a sentence was reworded or removed: re-enter it under its new key');
});

test('every cited code exists in a diagnostics table and some test asserts it; every pinning test exists', () => {
  for (const [k, value] of CLAIMS) {
    if (value === PENDING || value.startsWith('not a promise:')) continue;
    const pinned = value.match(/^pinned by (tests\/[\w.-]+): ./);
    if (pinned) {
      assert.ok(existsSync(root + pinned[1]), `${k} is pinned by ${pinned[1]}, which does not exist`);
      continue;
    }
    if (value.startsWith('pinned by')) assert.fail(`${k}: "pinned by tests/<file>: why" — ${value}`);
    assert.ok(codes.has(value), `${k} cites \`${value}\`, which no diagnostics.json defines`);
    assert.ok(testSources.includes(value), `${k} cites \`${value}\`, which no test names — a promise nothing checks`);
  }
});

test('the pending list only shrinks', () => {
  const pending = [...CLAIMS.values()].filter((value) => value === PENDING).length;
  assert.ok(pending <= PENDING_MAX, `${pending} pending, more than ${PENDING_MAX}: a new promise needs a code`);
});
