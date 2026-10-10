/**
 * **@verajs/ssr's diagnostics, keyed by code — every build** (code-system phase 4c, 2026-10-09). ssr is Node-only and
 * compiled per file with no `__DEV__`, so its words stay and each line gains its code (`report.ts` formats them),
 * as the jsx compiler's do: a server's log is read by its developer. `PROSE` is ssr's own, published as
 * `packages/ssr/diagnostics.json`. `TWINS` are facts @verajs/shared-utils already states — the renderer says them
 * in the browser — which ssr cannot import (it ships `src` with no dependencies): the SAME text under the same code,
 * held equal by `tests/ssr-shared-twins.test.mjs` on generated text, and never published here (their docs page is
 * shared-utils').
 */
type Prose = (...args: string[]) => readonly [string, string?];

export const PROSE: Record<string, Prose> = {
  'ssr-selector-unsupported': (selector, why) => [
    `this DOM cannot answer the selector ${selector} — ${why}.`,
    'It matches on structure and attributes only; rather than return a wrong answer it says so.',
  ],
  'ssr-markup-declined': () => [
    "some of this element's markup could not be parsed, so children/querySelector do not see it — they answer emptily, or with only the part that did parse.",
    'This DOM parses markup it can reproduce exactly and declines the rest, rather than building a tree the browser would not — a mismatched or stray closing tag is the usual cause. Make the markup well-formed, or build the children with createElement/appendChild if a component needs to read them back.',
  ],
  'ssr-listener-threw': (type) => [
    `a "${type}" listener threw — the dispatch went on, as in a browser; its error follows.`,
    'The error names what went wrong. This is said once per component and event type for the life of the process.',
  ],
  'ssr-setter-threw': (tag, name, thrown) => [
    `<${tag}> refused the bound property \`.${name}\` — its setter threw ${thrown}.`,
    "The binding's value is the argument it was given; the setter's own error is this one's cause.",
  ],
  'ssr-unfinished-tag': () => [
    'a template cannot end inside a tag — the client drops an unfinished tag.',
    'Close the tag inside the template.',
  ],
  'ssr-template-in-text': () => [
    'a template cannot render inside a text-only element (`<textarea>`, `<title>`…) — its content is text.',
    'Render a string there.',
  ],
  'ssr-nesting-depth': (max) => [
    `component nesting exceeded ${max} levels. A component that renders itself recurses without bound, and on a server that is a hung request — so this refuses rather than waiting for the stack to go.`,
    'If the tree is genuinely this deep it renders fine in a browser, which has no such limit; that difference is in the @verajs/ssr README.',
  ],
  'ssr-sheet-text': () => [
    'CSSStyleSheet.deleteRule needs a parsed rule list; this sheet is text.',
    'Remove the rule from the text instead, or replace the sheet.',
  ],
  'ssr-styles-vary': () => [
    'hoisted different CSS than it did on an earlier render, and the new stylesheet was dropped.',
    "A tag's styles are established once per class for the life of the process, so CSS that varies per request cannot be hoisted — put the varying part in an inline style or a custom property instead.",
  ],
  'ssr-prop-refused': (tag, thrown) => [
    `<${tag}> refused a value from \`props\` — setting it threw ${thrown}.`,
    'A read-only property cannot be set; pass it as an attribute, or give the class a setter. The setter\'s own error is this one\'s cause.',
  ],
  'ssr-async-connected': (tag) => [
    `<${tag}> has an async connectedCallback, which cannot be awaited during a synchronous render — its markup would be empty.`,
    'Use renderToStringAsync, or load data first and pass it as attributes.',
  ],
  'ssr-attribute-name': (name) => [
    `\`attributes\` cannot use ${name} as a name — an attribute name may not contain whitespace, a quote, "/", "=" or ">"; setAttribute refuses it in the browser too.`,
    'Give it a valid attribute name.',
  ],
  'ssr-option': (name, expected) => [`\`${name}\` must be ${expected}.`, 'Check the options passed to renderToString.'],
  'ssr-url-refused': (href, root) => [
    `refused ${href} — it resolves outside ${root}.`,
    'Nothing was imported. A module URL is bounded to `base`; point it at a module inside that directory.',
  ],
  'ssr-no-definition': (url) => [
    `no custom element definition found for ${url}.`,
    "Export the component's class from that module, or pass { tag }.",
  ],
  'ssr-renderer-replaced': () => [
    'the server renderer has been replaced — a renderer was wired that does not know @verajs/ssr is rendering, and every component would render empty.',
    "Import @verajs/ssr BEFORE wiring the renderer: vera's renderer then declines on the server and keeps only its shadow default. A renderer that is not vera's: guard its wiring (`if (!globalThis.__veraSsrShimmed)`).",
  ],
  'ssr-timeout': (timeout, pendingIn, waitingOn) => [
    `was served after its ${timeout} ms \`timeout\` with a promise still pending${pendingIn ? ` in ${pendingIn}` : ''} (an async connectedCallback, or a promise a frame callback returned), so the page is what had rendered by then.${waitingOn ? ` Still waiting on customElements.whenDefined for ${waitingOn}, which the server never defined.` : ''}`,
    `${waitingOn ? 'If only the browser defines it, return before that wait on the server — `if (globalThis.__veraSsrShimmed) return;` — so the server serves what the component shows before the wait, as the browser does first. ' : ''}Raise \`timeout\` if the wait is real, or find the promise that never settles. Said once per component for the life of the process.`,
  ],
  'ssr-static-write': (prop) => [
    `this render declared itself static, so its stores are not reactive and writing ${prop} would change nothing.`,
    'Remove `static: true` from renderToString, or stop writing to the store during the render.',
  ],
  'ssr-render-threw': (tag, others, thrown) => [
    `<${tag}> threw while rendering${others} — its markup would be empty: ${thrown}.`,
    "The component's own error is this one's cause.",
  ],
};

/** The shared-utils facts, word for word — see the header. The export names are shared-utils' (the name IS the code). */
export const TWINS = {
  getterOnlyProp: (key: string) => [
    `received a bound property \`.${key}\` (or \`!${key}\`), but its class declares \`${key}\` as a getter with no setter — the value cannot be delivered and the binding is ignored.`,
    'Add a setter, or stop binding it.',
  ] as const,
  tagHole: () => [
    'an expression in tag position (`<${…}>`) cannot be a tag name — a tag name must be a tag value.',
    "Use `tag`h1`` from @verajs/renderer/tag, with that entry's `html`.",
  ] as const,
  scriptUrl: (name: string) => [
    `\`${name}\` was given a javascript: URL — refused, and the attribute removed.`,
    'A bound URL is data, and data must never become code.',
  ] as const,
  nameExpression: (written: string, given: string) => [
    `an attribute name cannot be an expression — \`${written}\` is read by the parser before any value exists.`,
    `A name known only at runtime is a spread: \`\${spread({ [\`${written}\`]: ${given} })}\` (from @verajs/renderer/spread).`,
  ] as const,
  forgedTemplate: () => [
    'is shaped like a template but was not made by html`` — rendered as text.',
    'A template from data (JSON, or html([markup])) is never markup; for trusted markup, bind it: <div .innerHTML=${markup}>.',
  ] as const,
};
