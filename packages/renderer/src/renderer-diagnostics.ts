/**
 * **The renderer entry's diagnostics, keyed by code — DEVELOPMENT ONLY** (referenced behind `__DEV__`; production drops
 * it). One table per bundle entry — this one is `vera-renderer.js`'s own; codes another bundle or package also prints
 * live in shared-utils' table. `scripts/sync-diagnostics.mjs` merges the renderer's tables into its `diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'renderer-options': (given) => [
    `was given ${given}, not an options object, so it set no default.`,
    "Pass an object: renderer({ shadow: 'open' }).",
  ],
  'renderer-on-server': () => [
    'is not wired for rendering: @verajs/ssr is loaded, so this process is a server and renders with its own renderer — only the shadow default was taken.',
    'Nothing to fix in a server. Code that needs the client renderer in this process installs a client DOM and calls renderInto directly, or renders the server half in a separate process.',
  ],
  'ref-threw': () => [
    'threw; its error is printed beside this line, and the render continued without it.',
    "Fix the ref, or wire an 'error' insert to handle what refs throw.",
  ],
  /* ── a template's own source (said once per template) ── */
  'self-closed-tag': (tag) => [
    `<${tag}> is left OPEN by this template, so everything after it becomes its child rather than its sibling. HTML has no self-closing syntax outside <svg> and <math> — \`<${tag} />\` is an open tag, not an empty element.`,
    `Write \`<${tag}></${tag}>\`. (@verajs/jsx rewrites this for you; a hand-written template has to say it.)`,
  ],
  'void-end-tag': (tag) => [
    `\`</${tag}>\` is read by the parser as ANOTHER <${tag}>, so this template renders two where it describes one.`,
    `A void element has no end tag — write \`<${tag}>\` alone.`,
  ],
  'foreign-raw-text': (tag) => [
    `a binding inside <${tag}> in SVG or MathML cannot sit beside an element there — the renderer reads <${tag}> as text and rebuilds it around its bindings, which destroys the elements in it.`,
    `Bind text directly in the <${tag}> (no elements), or move the element out of it.`,
  ],
  'obsolete-raw-text': (tag) => [
    `a binding inside <${tag}> is never rendered — the parser reads its content as text whole, and <${tag}> is obsolete.`,
    'Use <pre> for preformatted text.',
  ],
  'unfinished-tag': () => [
    'a template cannot end inside a tag — the parser drops an unfinished tag.',
    'Close the tag inside the template.',
  ],
  'inert-binding': (position) => [
    `the value at position ${position} sits inside a nested <template>'s content — inert markup that is never rendered — so it is ignored (and the server ignores it too).`,
    'Render into the live tree instead.',
  ],
  'dropped-binding': (where, lost) => [
    `${where} never reached the parsed tree — the HTML parser DROPPED the element it was written on, because its parent's content model forbids it (\`<select>\` takes only options, \`<form>\` cannot nest, and so on). ${lost} binding(s) lost; the bindings AFTER it are unaffected, because each marker carries its own index.`,
    'Move the element out of its parent, or use one the parent can hold.',
  ],
  'table-binding': () => [
    'a binding sits directly inside <table>, where the HTML parser inserts a <tbody> that a client render does not. The same template then renders as `table > tr` and parses as `table > tbody > tr`, so `table > tr` selectors match on only one path and hydration rebuilds this container instead of adopting it.',
    'Write the section explicitly — `<table><tbody>${rows}</tbody></table>` — and every path agrees.',
  ],
  'wrong-namespace': (tag, built, host, advice) => [
    `<${tag}> was built as ${built} and placed inside <${host}>, where it will not render.`,
    advice,
  ],
  /* ── values (said as they happen) ── */
  'boolean-child': (value) => [
    `a child position was given \`${value}\`, which renders as the word "${value}" — the usual cause is \`\${cond && …}\` with a false \`cond\`.`,
    'Write `${cond ? … : null}`, or `${(cond && …) || null}`; `null` and `undefined` are the values that render nothing. If you meant to display the boolean, say so with `${String(value)}` and this goes quiet.',
  ],
  'event-name-typo': (name, tag, best) => [
    `@${name} is not an event <${tag}> fires — did you mean @${best}? (In JSX, on${name.slice(0, 1).toUpperCase()}${name.slice(1)} compiles to @${name}.)`,
    'A custom event by this name is fine, and this is said only in development.',
  ],
  'applier-identity': (swaps) => [
    `a child applier changed identity ${swaps} times at one part, so \`previous\` is always undefined and it restarts every render.`,
    'Hoist the applier — written as an object-literal method it is a new function per call: `function applyThing(part, previous) { … }` once at module scope, and `const thing = (x) => ({ _$child$: applyThing, x })` with the state on the object.',
  ],
  /* ── wiring and calls ── */
  'slots-unwired': () => [
    'renders a `<slot>` into LIGHT DOM, but @verajs/renderer/slots is not wired, so nothing is distributed.',
    'Wire it BEFORE anything renders: wire([renderer, slots]).',
  ],
  'no-container': (received) => [
    `expected a container node as the second argument and received ${received}.`,
    'It renders *into* something — `renderInto(html`…`, document.body)`.',
  ],
};
