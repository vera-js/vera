/**
 * **The codes more than one package prints — DEVELOPMENT ONLY, except to the jsx compiler** (2026-10-09). A
 * fact said by two emitters has
 * ONE docs page and ONE text, so its prose lives here, in the lowest dependency every emitter shares, and each raises
 * it as `SHARED['code']` — never a second sentence in a second table (the dev line would stop being the docs page's
 * text). Referenced only behind `__DEV__`, so production drops it whole — but the jsx COMPILER raises `voidChildren`
 * and `styleObject` in every build: a compile error is a build tool's only output, and Vite loads the production one. `scripts/sync-diagnostics.mjs` publishes it
 * as `packages/shared-utils/diagnostics.json`; the uniqueness check sees each code here once.
 *
 * Also the home of messages shared-utils' OWN code prints on a renderer's behalf (adopt-property, markup-grammar,
 * isSelection) — the same rule: the emitter is shared, so the text is.
 *
 * **One named export per code, never one object** (measured 2026-10-09): rollup cannot drop an unused KEY of
 * an object literal, so a shared `PROSE` object put every shared message into every importer's development bundle.
 * A named export is dropped per function. **The export's name IS the code** — `tagCalled` is `tag-called` — so the
 * map sync and the tests read is derived (`proseOf`, scripts/diagnostic-tables.mjs), never kept by hand, and a call
 * `SHARED.tagCalled(…)` names its code exactly once.
 */
import type { Prose } from './types.js';

/**
 * core's `html`/`svg`/`mathml` and the renderer's `tag` — a tagged template called as a function. The FACT is shared;
 * the EXAMPLE is each emitter's: `html` writes markup, `tag` an element name — so the emitter passes it.
 */
export const tagCalled: Prose = (tag, received, example) => [
  `expected a template literal and received ${received}.`,
  `It is a tagged template — write ${tag}\`${example}\`, not ${tag}('${example}').`,
];
/**
 * A template in a text-only element (`<style>`, a JSON data block, `<title>`, `<textarea>`): its content is text. Lite
 * refuses it, and so does the renderer in a style or JSON block (the server: `ssr-template-in-text`); in a `<title>` or
 * `<textarea>` the renderer places it, as it always has, and says so in development only. A list there is joined.
 */
export const templateInText: Prose = () => [
  'a template inside a text-only element (`<style>`, a JSON `<script>`, `<title>`, `<textarea>`, or never-shown content: `<noscript>`, `<iframe>`) is never shown as markup — its content is text.',
  'Render a string there; a list of strings is joined.',
];
/** A template that ends inside a tag: the renderer refuses it in development, the lite tier in every build. */
export const unfinishedTag: Prose = () => [
  'a template cannot end inside a tag — the parser drops an unfinished tag.',
  'Close the tag inside the template.',
];
/** core's props adoption on an `init()` element, and the renderer's on any other element. */
export const getterOnlyProp: Prose = (key) => [
  `received a bound property \`.${key}\` (or \`!${key}\`), but its class declares \`${key}\` as a getter with no setter — the value cannot be delivered and the binding is ignored.`,
  'Add a setter, or stop binding it.',
];
/** shared-utils' `adoptProperty` (renderer, spread): an element that never drains the record loses it at upgrade. */
export const upgradeClobber: Prose = (name) => [
  `the value bound to \`${name}\` was replaced while the element upgraded. A class field is the usual cause: at ES2022 \`${name}?: …\` emits \`${name};\`, which runs during upgrade and overwrites whatever was set beforehand.`,
  `Write it \`declare ${name}?: …\` instead. A component that calls init() adopts bound properties automatically and never sees this; this element did not. Ignore this if the component replaced the value on purpose.`,
];
/** shared-utils' `isSelection` (renderer, spread). */
export const selectMultiple: Prose = (name) => [
  `\`${name}\` controls only ONE selection here, and a selection the user adds is kept — it is not controlled.`,
  'Bind `?selected=${…}` on each <option> to control every selection.',
];
/** shared-utils' `contentClash` (renderer, spread): a content-replacing property beside content of the element's own. */
export const contentClash: Prose = (tag, name, alone) => [
  `<${tag}> binds \`.${name}\`, which replaces the element's content, and also has content of its own — markup or a child binding, which the write would strand.`,
  `Bind one or the other: the property alone (\`${alone}\`), or the content alone.`,
];
/** shared-utils' `tagHole` (renderer; @verajs/ssr keeps a twin). */
export const tagHole: Prose = () => [
  'an expression in tag position (`<${…}>`) cannot be a tag name — a tag name must be a tag value.',
  "Use `tag`h1`` from @verajs/renderer/tag, with that entry's `html`.",
];
/** core's `wire` (at wire time) and the renderer (a template built before slots was wired, at render). */
export const lateTemplateModule: Prose = () => [
  "a 'template' or 'element' module (namespaces, elements, slots) was wired after the renderer had already built templates — those never ask it, and keep rendering without it.",
  'Wire it beside the renderer, before the first render.',
];
/** The renderer and spread (two bundles), `@verajs/lite` and `@verajs/static`; @verajs/ssr refuses the same URLs silently today. */
export const scriptUrl: Prose = (name) => [
  `\`${name}\` was given a javascript: URL — refused, and the attribute removed.`,
  'A bound URL is data, and data must never become code.',
];
/**
 * The renderer and spread, `@verajs/lite` and `@verajs/static`: `kind` is what the value was (dev-values'
 * `attributeValueKind`); `property` is the emitter's own spelling of a property binding — a template's
 * `.name=${value}`, a spread's `'.name': value`.
 */
export const attributeValue: Prose = (name, kind, property) => [
  `the attribute \`${name}\` was given ${kind}. An attribute value is a string and nothing else.`,
  `If the element is meant to RECEIVE this value, bind a property instead — \`${property}\` — which is how a custom element takes anything that is not text. If it is meant to be read as text, convert it where you know what it means: \`date.toISOString()\`, \`list.join(' ')\`. A Date in particular serializes with the SERVER's timezone on one side and the browser's on the other, so it will not survive hydration.`,
];
/** The renderer and spread: `type` is the value's `typeof`. */
export const notAListener: Prose = (name, type) => [
  `@${name} was given ${type === 'object' ? 'an object with no handleEvent method' : `a ${type}`}, which cannot listen — the event will do nothing.`,
  'Pass a function, or an object with a handleEvent method. A missing handler is `undefined` or `false`, both of which are fine; this is neither.',
];
/** The renderer (and @verajs/ssr's twin): an expression inside an attribute NAME. */
export const nameExpression: Prose = (written, given) => [
  `an attribute name cannot be an expression — \`${written}\` is read by the parser before any value exists.`,
  `A name known only at runtime is a spread: \`\${spread({ [\`${written}\`]: ${given} })}\` (from @verajs/renderer/spread).`,
];
/** The renderer and lite (`namespaces.ts`): an element placed where its namespace does not render. `advice` is built there. */
export const wrongNamespace: Prose = (tag, built, host, advice) => [
  `<${tag}> was built as ${built} and placed inside <${host}>, where it will not render.`,
  advice,
];
/** The renderer (and, ruled 2026-10-09, @verajs/ssr): data shaped like a template, not made by `html`. */
export const forgedTemplate: Prose = () => [
  'is shaped like a template but was not made by html`` — rendered as text.',
  'A template from data (JSON, or html([markup])) is never markup; for trusted markup, bind it: <div .innerHTML=${markup}>.',
];
/** The renderer and spread (two bundles; @verajs/ssr refuses the same): binding `__proto__`. */
export const protoBinding: Prose = (written) => [
  `binds \`${written}\`, which would replace the element's own prototype and destroy it — no property write does this, and no use of it is legitimate.`,
  'The binding is ignored.',
];
/** The renderer and spread: a bound `srcdoc` ATTRIBUTE. `property` is the emitter's spelling of the property binding. */
export const srcdocAttribute: Prose = (property) => [
  'binds the `srcdoc` attribute, which renders its value as an HTML document — refused.',
  `If the markup is trusted and sanitized, bind the property: \`${property}\`.`,
];
/** Every emitter and the server: a bound URL on a `<script>` (`src`, SVG's `href`). `written` is the binding as written. */
export const scriptSource: Prose = (written) => [
  `binds \`${written}\` on a <script>, whose URL chooses the code it runs — refused.`,
  'Write the URL into the template (it is then the author\'s own), or load the module with `import()`.',
];
/** The renderer and spread: a bound inline-handler attribute (`onclick`). `event` is the emitter's event spelling(s). */
export const handlerAttribute: Prose = (name, event) => [
  `binds the \`${name}\` attribute, which runs its value as code — refused.`,
  `Bind a function as an event instead: ${event}.`,
];
/**
 * The jsx compiler and the renderer's `tag` — children given to a void element. Both refuse; the FATE the refusal
 * prevents is each emitter's: compiled, they would land after the element; through `tag`, vanish.
 */
export const voidChildren: Prose = (tag, fate) => [
  `<${tag}> is a void element — it has no end tag and takes no children, so ${fate}; refused.`,
  'Move the children out, or use an element that takes content.',
];
/** The jsx compiler and the renderer's `tag` — an object `style`. The EXAMPLE is each emitter's spelling. */
export const styleObject: Prose = (example) => [
  'style expects a STRING, not an object.',
  `Build the string: ${example}.`,
];
/**
 * An option a module or loader does not have — autoloader(), directiveLoader(), router(), and the directives packs
 * remote(), sensors(), motion(). One fact and one fix; the module is the line's SUBJECT and the list is its own.
 */
export const unknownOption: Prose = (key, list) => [
  `\`${key}\` is not an option, so it was ignored.`,
  `The options are ${list}.`,
];

/* ── `define`'s checks (define-checks.ts) and the setup's result: said by `@verajs/core` and `@verajs/lite` (moved from core's table, 2026-11-17) ── */
export const defineAttributeReflected: Prose = (prop) => [
    `observes an attribute whose prop, \`${prop}\`, is one the platform's element already REFLECTS — this tag's accessor replaces it, so setting \`el.${prop}\` no longer does what the platform's does (it no longer writes the attribute).`,
    'Observe it only if the component owns that attribute; otherwise read it in the render with `host.getAttribute(…)`.',
];
export const defineAttributeType: Prose = (prop, type) => [
    `shares the prop \`${prop}\`, whose default is a ${type} — and the attribute arrives as a STRING, so the prop changes type the moment it appears.`,
    'Give the prop a string (or null) default, and convert in the render; or keep the attribute and the prop under different names.',
];
export const defineAttributes: Prose = (received) => [
    `expected an array of attribute names and received ${received}.`,
    "List them: `attributes: ['label', 'data-count']` — each arrives as a prop (`label`, `dataCount`).",
];
export const defineMethodAdopted: Prose = () => [
    'an `adoptedCallback` costs every element of this tag its creation (measured +7.4% on create10k), and it is installed.',
    'Keep it only if moving elements between documents needs it.',
];
export const defineMethodIgnored: Prose = (name) => [
    `\`${name}\` is core's own on a define-made class, so this one is never installed (in any build).`,
    name === 'constructor'
      ? 'A setup is where per-instance work goes: `define(tag, (host) => { … })`.'
      : 'Put connect-time work in the setup; for work on removal, a `disconnectedCallback` in methods runs as the teardown hook.',
];
export const defineMethodNotFunction: Prose = () => [
    'is not a function, so it is installed as a plain value shared by every instance — and a getter ran ONCE, here.',
    'Methods are functions; a value that changes per element is a prop (`props: { name: default }`).',
];
export const defineMethodUnobserved: Prose = () => [
    'never fires: the class observes no attributes, and it is installed anyway.',
    "Declare them: `define({ tag, attributes: ['label'] }, …)` — each then arrives as a prop.",
];
export const definePropMethod: Prose = (name) => [
    `\`${name}\` is also a method, and the prop wins (it is installed after the methods), in every build.`,
    'Give the method or the prop another name.',
];
export const definePropSharedDefault: Prose = () => [
    'this default is an object that cannot be copied per element (a Set, a Map, a class instance), so EVERY element of the tag shares this one — a change through one shows in all.',
    'Declare it `null` and create it in the setup (`props: { selected: null }`, then `host.selected = new Set()`), or pass it in; arrays and plain objects are copied per element.',
];
export const definePropsNotObject: Prose = (received) => [
    `expected an object of names and their defaults and received ${received}, so no prop is declared.`,
    "Name each prop with its default: `props: { heading: '', items: [] }`.",
];
export const defineProtoKey: Prose = (kind) => [
    `is skipped, in every build: written onto the ${kind === 'prop' ? 'props record' : 'class prototype'} it would replace a prototype instead of adding a ${kind}.`,
    'Rename the key. An own `__proto__` comes from `JSON.parse` or `Object.defineProperty`, never from an object literal.',
];
export const defineSetup: Prose = (received) => [
    `the second argument is the SETUP, a function, and received ${received}.`,
    'Pass the setup after the tag or the options: `define(\'x-card\', (host) => () => html`…`)`.',
];
export const defineShadows: Prose = (name) => [
    `replaces the platform's \`${name}\` for every user of these elements — scripts, libraries and the browser's own callers — and it is installed.`,
    'Give it a name of its own, unless replacing the platform member is the point.',
];
export const defineTag: Prose = (received) => [
    `expected a custom element name — a string with a hyphen, not at the start — and received ${received}.`,
    "Name it the way the platform requires: `define('x-card', setup)` or `define({ tag: 'x-card' }, setup)`.",
];
export const tagDefinedAgain: Prose = (tag) => [
    `<${tag}> is already defined; the platform refuses a second definition of a tag and throws next.`,
    'Define each tag once, at module level. A live swap of a component while developing needs the development swap module, wired before the first define.',
];
/**
 * **A second copy of a component package stands down** — said in development by every `@vera-components/*` package's
 * `register` when its tag is already defined (by another copy or version of the same package): the first definition is
 * kept. One text for every component (2026-11-20; codes are one namespace). The tag is the diagnostic's subject, printed
 * before the message; `pkg` is the package's name and `entry` its element entry (`element` or `elements`).
 */
export const definedTwice: Prose = (pkg, entry) => [
  `is already defined by another copy or version of ${pkg}, so the first is kept.`,
  `Align the versions, or import ${pkg}/${entry} and define it under your own tag.`,
];
export const setupReturnedValue: Prose = (kind) => [
    `its setup returned ${kind}, not a render function, so it rendered once and will never update.`,
    'Return a render function — `return () => html`…`;` — the setup runs once, the render on every change.',
];
/**
 * **A boolean at a child position renders as the WORD** — said in development by `@verajs/renderer`, `@verajs/lite` and
 * `@verajs/static` (moved from the renderer's table, 2026-11-19: the small tiers say core's development diagnostics too).
 */
export const booleanChild: Prose = (value) => [
    `a child position was given \`${value}\`, which renders as the word "${value}" — the usual cause is \`\${cond && …}\` with a false \`cond\`.`,
    'Write `${cond ? … : null}`, or `${(cond && …) || null}`; `null` and `undefined` are the values that render nothing. If you meant to display the boolean, say so with `${String(value)}` and this goes quiet.',
];
/** **A misspelled event name** (`@clik`) — said in development by `@verajs/renderer` and `@verajs/lite` (moved 2026-11-19). */
export const eventNameTypo: Prose = (name, tag, best) => [
    `@${name} is not an event <${tag}> fires — did you mean @${best}? (In JSX, on${name.slice(0, 1).toUpperCase()}${name.slice(1)} compiles to @${name}.)`,
    'A custom event by this name is fine, and this is said only in development.',
];
/**
 * **A wrapper around a real template literal's strings is no template in the small tiers** — `{ strings, values }` without
 * `_$litType$`, which only `@verajs/core`'s `hold` or `tag` build: a template to core, the text `[object Object]` in
 * `@verajs/lite` and `@verajs/static` (Brian, 2026-11-19: a recorded difference, said in development by both).
 */
export const templateWrapper: Prose = () => [
    "an object holding a real template literal's `strings` but no `_$litType$` — a wrapper only `@verajs/core`'s `hold` or `tag` builds — is no template here: it renders as the text any object renders as, `[object Object]`.",
    'Render the `html` result itself; `@verajs/core` renders such a wrapper as its template.',
];
