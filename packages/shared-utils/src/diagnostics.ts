/**
 * **The codes more than one package prints — DEVELOPMENT ONLY** (vera-5a, 2026-10-09). A fact said by two emitters has
 * ONE docs page and ONE text, so its prose lives here, in the lowest dependency every emitter shares, and each raises
 * it as `SHARED['code']` — never a second sentence in a second table (the dev line would stop being the docs page's
 * text). Referenced only behind `__DEV__`, so production drops it whole. `scripts/sync-diagnostics.mjs` publishes it
 * as `packages/shared-utils/diagnostics.json`; the uniqueness check sees each code here once.
 *
 * Also the home of messages shared-utils' OWN code prints on a renderer's behalf (adopt-property, markup-grammar,
 * isSelection) — the same rule: the emitter is shared, so the text is.
 *
 * **One named export per code, never one object** (vera-5a, measured 2026-10-09): rollup cannot drop an unused KEY of
 * an object literal, so a shared `PROSE` object put every shared message into every importer's development bundle.
 * A named export is dropped per function. **The export's name IS the code** — `tagCalled` is `tag-called` — so the
 * map sync and the tests read is derived (`proseOf`, scripts/diagnostic-tables.mjs), never kept by hand, and a call
 * `SHARED.tagCalled(…)` names its code exactly once.
 */
import type { Prose } from './types.js';

/**
 * core's `html`/`svg`/`mathml` and the renderer's `tag` — a tagged template called as a function. The FACT is shared;
 * the EXAMPLE is each emitter's (vera-5a): `html` writes markup, `tag` an element name — so the emitter passes it.
 */
export const tagCalled: Prose = (tag, received, example) => [
  `expected a template literal and received ${received}.`,
  `It is a tagged template — write ${tag}\`${example}\`, not ${tag}('${example}').`,
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
/** shared-utils' `tagHole` (renderer; @verajs/ssr keeps a twin, phase 4). */
export const tagHole: Prose = () => [
  'an expression in tag position (`<${…}>`) cannot be a tag name — a tag name must be a tag value.',
  "Use `tag`h1`` from @verajs/renderer/tag, with that entry's `html`.",
];
/** core's `wire` (at wire time) and the renderer (a template built before slots was wired, at render). */
export const lateTemplateModule: Prose = () => [
  "a 'template' or 'element' module (namespaces, elements, slots) was wired after the renderer had already built templates — those never ask it, and keep rendering without it.",
  'Wire it beside the renderer, before the first render.',
];
/** The renderer and spread (two bundles); @verajs/ssr refuses the same URLs silently today (phase 4). */
export const scriptUrl: Prose = (name) => [
  `\`${name}\` was given a javascript: URL — refused, and the attribute removed.`,
  'A bound URL is data, and data must never become code.',
];
/**
 * The renderer and spread: `kind` is what the value was (dev-values' `attributeValueKind`); `property` is the
 * emitter's own spelling of a property binding — a template's `.name=${value}`, a spread's `'.name': value`.
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
/** The renderer (and @verajs/ssr's twin, phase 4): an expression inside an attribute NAME. */
export const nameExpression: Prose = (written, given) => [
  `an attribute name cannot be an expression — \`${written}\` is read by the parser before any value exists.`,
  `A name known only at runtime is a spread: \`\${spread({ [\`${written}\`]: ${given} })}\` (from @verajs/renderer/spread).`,
];
/** The renderer (and, ruled 2026-10-09, @verajs/ssr in phase 4): data shaped like a template, not made by `html`. */
export const forgedTemplate: Prose = () => [
  'is shaped like a template but was not made by html`` — rendered as text.',
  'A template from data (JSON, or html([markup])) is never markup; for trusted markup, bind it: <div .innerHTML=${markup}>.',
];
/** The renderer and spread (two bundles; @verajs/ssr refuses the same, phase 4): binding `__proto__`. */
export const protoBinding: Prose = (written) => [
  `binds \`${written}\`, which would replace the element's own prototype and destroy it — no property write does this, and no use of it is legitimate.`,
  'The binding is ignored.',
];
/** The renderer and spread: a bound `srcdoc` ATTRIBUTE. `property` is the emitter's spelling of the property binding. */
export const srcdocAttribute: Prose = (property) => [
  'binds the `srcdoc` attribute, which renders its value as an HTML document — refused.',
  `If the markup is trusted and sanitized, bind the property: \`${property}\`.`,
];
/** The renderer and spread: a bound inline-handler attribute (`onclick`). `event` is the emitter's event spelling(s). */
export const handlerAttribute: Prose = (name, event) => [
  `binds the \`${name}\` attribute, which runs its value as code — refused.`,
  `Bind a function as an event instead: ${event}.`,
];
