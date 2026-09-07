/**
 * **Every refusal this package can record, keyed by its code — DEVELOPMENT ONLY.**
 *
 * Two problems, one answer.
 *
 * The first is bytes. `reject()` has always discarded prose in production
 * (`message: __DEV__ ? message : ''`), but the fold happened INSIDE the function, so every caller
 * still built its string and all of them shipped — measured at 1,030 B gzipped, about 3% of the
 * package, for text thrown away microseconds later. Every other package in the tree guards at the
 * call site instead; this one did not. Here the prose lives behind a lookup that only development
 * performs, so the module goes unreferenced when `__DEV__` folds and rollup drops it whole.
 *
 * The second is that a scatter of string literals cannot be READ BY ANYTHING. As one table the
 * codes become a manifest: `tests/diagnostics-table.test.mjs` can insist every code raised in the
 * source has an entry and every entry is actually raised, so an orphan or a typo is a gate failure
 * rather than something nobody notices. It also generates `diagnostics.json`, which is how a code
 * turns into a docs page and how **Vera Studio** shows a full sentence for a rejection while
 * running a production bundle — Studio's author is a developer, and production there is not the
 * end-user context the fold assumes.
 *
 * That manifest earned itself immediately: `every-not-object` and `swipe-not-object` were each
 * doing two different jobs — *the attribute is not an object* and *one ENTRY's value is not an
 * object* — which no reader of either call site would notice and which would have made one docs
 * page and one inspector row wrong for both. They are now four codes.
 *
 * **A third party keeps writing its own prose**: `ctx.reject(code, 'message', 'fix')` passes text
 * through verbatim, because their codes are not in this table and their bytes are not ours to
 * fold. The array form, `ctx.reject(code, [args])`, is what asks this table.
 */
/**
 * Entry parameters are typed `string` because that is how they READ, and the sentence is what this
 * file is for. The call path accepts `readonly unknown[]` and casts here: an argument reaches a
 * template literal, which stringifies a number or a null exactly as the console would print it, so
 * demanding `String(...)` at forty call sites would buy nothing but noise.
 */
export type Prose = (...args: string[]) => [string, string?];

/**
 * The PARSER's refusals, which arrive differently from every other code here.
 *
 * `parse.ts` throws a `ValueError` carrying its own code and its own already-precise sentence
 * (*"an object entry needs key: value, at 14"*), and the engine converts that to a rejection under
 * the parser's code — so the words are composed at throw time and the table's job is only to frame
 * them. One shared entry rather than thirteen copies of the same wrapper: they differ in what went
 * wrong, and the parser is what knows that.
 */
const parseFailure: Prose = (raw, detail) => [
  `could not parse "${raw}"${detail ? `: ${detail}` : ''}.`,
  'Check the attribute value against the syntax for this directive.',
];

export const PROSE: Record<string, Prose> = {
  'value-bad': parseFailure,
  'number-bad': parseFailure,
  'object-bad-key': parseFailure,
  'object-duplicate-key': parseFailure,
  'object-missing-colon': parseFailure,
  'object-unterminated': parseFailure,
  'path-bad': parseFailure,
  'string-unterminated': parseFailure,
  'value-empty': parseFailure,
  'value-too-deep': parseFailure,
  'value-too-long': parseFailure,
  'value-trailing': parseFailure,
  'value-unexpected': parseFailure,
  /** The expressions tier's own vocabulary, thrown and converted by the same route. */
  'array-unterminated': parseFailure,
  'call-unterminated': parseFailure,
  'expr-empty': parseFailure,
  'expr-too-deep': parseFailure,
  'expr-trailing': parseFailure,
  'expr-unclosed-paren': parseFailure,
  'expr-unexpected': parseFailure,
  'name-forbidden': parseFailure,
  'strict-spelling': parseFailure,
  'ternary-missing-colon': parseFailure,
  'unknown-function': parseFailure,
  'bind-refused-target': (target: string) => [`"${target}" is not bindable — it is a navigation/script sink or has its own directive.`, `Use the class/style directives, or a real link written in markup.`],
  'class-not-object': () => [`data-vd-class takes a braced object of name: expression.`],
  'copy-refused': () => [`the clipboard write was refused.`],
  'copy-unavailable': () => [`the Clipboard API is unavailable here.`],
  'directive-threw': (detail: string) => [detail],
  'doc-class-not-object': () => [`data-vd-doc-class takes a braced object.`],
  'every-bad-interval': (key: string) => [`"${key}" is not a positive whole number of milliseconds.`],
  'every-entry-not-object': (ms: string) => [`the value for ${ms} must be a braced assignments object.`],
  'every-not-object': () => [`data-vd-every takes { interval: { assignments } }.`],
  'fetch-failed': (url: string, status: string) => [`${url} answered ${status}.`],
  'fetch-foreign-markup': () => [`a cross-origin response may only be JSON — markup is never swapped from another origin.`, `Return application/json, or serve the fragment from this origin.`],
  'fetch-json-not-object': () => [`a JSON response must be an object of state keys.`],
  'fetch-not-object': () => ['data-vd-fetch takes a braced object.', `Write data-vd-fetch="{ url: '/path', on: 'click' }".`],
  'fetch-target-missing': (detail: string) => [`"${detail}" matched no element to swap into.`],
  'fetch-threw': (detail: string) => [detail],
  'fetch-url-refused': (detail: string) => [`"${detail}" is not a URL this page may request.`, `It must be http(s) and same-origin, unless the origin is in remote({ allowedOrigins }).`],
  'focus-trap-empty': () => [`nothing focusable to trap.`, `Add a focusable child, or remove the trap.`],
  'handler-not-object': () => [`an on-* value is a braced assignments object.`],
  'key-not-writable': (key: string) => [`"${key}" is a path, and a path can be read but not written.`, `Write the whole object under its own key, or use a flat key.`],
  'loader-failed': (suffix: string, detail: string) => [`the loader claimed "${suffix}" but the import failed: ${detail}`],
  'loader-loaded-nothing': (suffix: string) => [`a module loaded for "${suffix}" but registered nothing by that name.`, `The module must call wireDirectives with a matching directive.`],
  'no-carrier': (key: string) => [`a write to "${key}" found no data-vd-state ancestor.`, `Add one, or use an @page key.`],
  'origin-not-url': (detail: string) => [`allowedOrigins entry ${detail} is not a url; ignoring it.`, `Write the full origin, for example "https://api.example".`],
  'persist-unavailable': () => [`storage is unavailable — running live-only.`],
  'query-no-keys': () => [`data-vd-query needs one or more state keys.`, `Write data-vd-query="q tag page".`],
  'region-bad-selector': (selector: string) => [`"${selector}" is not a selector.`],
  'region-not-object': () => ['data-vd-region takes a braced object.', `Write data-vd-region="{ items: '.card', search: 'q' }".`],
  'scroll-to-missing': () => [`the scroll target matched nothing.`],
  'sensor-no-key': (attr: string) => [`${attr} needs the name of a state key to write.`, `Write ${attr}="seen" and read it with data-vd-show="seen".`],
  'server-unsettled': (limit: string) => [`state was still changing after ${limit} server passes, so the markup may not be final.`, 'A directive is writing a different value every run — compare before writing.'],
  'state-not-object': () => [`data-vd-state takes a braced object.`, `Write data-vd-state="{ open: false }".`],
  'state-reseed-ignored': () => [`the state declaration changed after activation; live state kept.`],
  'state-reserved-key': (key: string) => [`"${key}" is reserved.`],
  'style-not-object': () => [`data-vd-style takes a braced object of prop: expression.`],
  'swipe-bad-direction': (name: string) => [`"${name}" is not a direction — use left, right, up or down.`],
  'swipe-entry-not-object': (name: string) => [`the value for "${name}" must be a braced assignments object.`],
  'swipe-not-object': () => [`data-vd-swipe takes { left: { … }, right: { … } }.`],
  'sync-not-a-control': () => [`data-vd-sync needs a form control with a value.`, `Put it on an input, select or textarea.`],
  'sync-radio-unsupported': () => [`radio groups need group semantics — not in v1.`, `Bind on-change + bind-checked per radio.`],
  'teardown-threw': (detail: string) => [detail],
  'undeclared-write': (key: string) => [`"${key}" was not declared by the state it landed in.`, `Declare it in data-vd-state.`],
  'unknown-directive': (suffix: string, declined?: string) => [
    `nothing wired provides "${suffix}".`,
    declined ? 'The loader declined it — check the name, or its alias map.' : 'Wire its pack, or check the name.',
  ],
  'unknown-key': (head: string) => [`no ancestor state declares "${head}".`, `Reads answer undefined.`],
};
