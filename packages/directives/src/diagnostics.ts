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
 * Entries are the shared `Prose` (one type for every package's table). Their parameters are typed `string` because
 * that is how they READ, and the sentence is what this file is for. The call path accepts `readonly unknown[]` and
 * casts here: an argument reaches a template literal, which stringifies a number or a null exactly as the console would
 * print it, so demanding `String(...)` at forty call sites would buy nothing but noise.
 */
import type { Prose } from '@verajs/shared-utils';

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
  'prose-duplicate': (code) => [
    `"${code}" already has its text — this engine's own, or a pack registered earlier — so this registration's is ignored.`,
    "Give a pack's codes a prefix of its own: a code reads one way everywhere.",
  ],
  'core-protocol': () => [
    'this @verajs/core and @verajs/directives are from different releases — directives keep their own store machinery, so a directive write will not wake a component.',
    'Update both together.',
  ],
  'array-not-literal': parseFailure,
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
  'bind-refused-target': (target: string) => [`"${target}" is not bindable — it is a navigation/script sink or has its own directive.`, `Use the class/style directives, or a real link written in markup.`],
  'class-not-object': () => [`data-vd-class takes a braced object of name: expression.`],
  'copy-refused': () => [`the clipboard write was refused.`],
  'copy-unavailable': () => [`the Clipboard API is unavailable here.`],
  'directive-threw': (detail: string) => [`the directive threw: ${detail}`, 'The element keeps what it had; the expression, or the handler it runs, is what to fix.'],
  'doc-class-not-object': () => [`data-vd-doc-class takes a braced object.`],
  'every-bad-interval': (key: string) => [`"${key}" is not a positive whole number of milliseconds.`],
  'every-entry-not-object': (ms: string) => [`the value for ${ms} must be a braced assignments object.`],
  'every-not-object': () => [`data-vd-every takes { interval: { assignments } }.`],
  'fetch-bad-cache': (given: string) => [`cache: ${given} is not a positive number of seconds.`],
  'fetch-bad-debounce': (given: string) => [`debounce: ${given} is not a positive number of milliseconds.`],
  'fetch-failed': (url: string, status: string) => [`${url} answered ${status}.`],
  'fetch-foreign-markup': () => [`a cross-origin response may only be JSON — markup is never swapped from another origin.`, `Return application/json, or serve the fragment from this origin.`],
  'fetch-json-not-object': () => [`a JSON response must be an object of state keys.`],
  'fetch-not-object': () => ['data-vd-fetch takes a braced object.', `Write data-vd-fetch="{ url: '/path', on: 'click' }".`],
  'fetch-place-unknown': (detail: string) => [`place: "${detail}" is not a placement.`, `Use 'append', 'prepend', or omit it for replace.`],
  'fetch-target-missing': (detail: string) => [`"${detail}" matched no element to swap into.`],
  'fetch-threw': (detail: string) => [`the fetch threw: ${detail}`, 'The request did not complete — check the URL, the network, and what the response handling expects.'],
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
  'list-bad-selector': (selector: string) => [`"${selector}" is not a selector.`],
  'list-not-object': () => ['data-vd-list takes a braced object.', `Write data-vd-list="{ items: '.card', search: 'q' }".`],
  'stream-foreign-markup': () => [`a cross-origin stream may only push JSON — markup is never swapped from another origin.`, `Push application/json-shaped messages, or serve the stream from this origin.`],
  'stream-json-not-object': () => [`a JSON message must be an object of state keys.`],
  'stream-not-object': () => ['data-vd-stream takes a braced object.', `Write data-vd-stream="{ url: '/live', status: 'link' }".`],
  'stream-queue-full': (cap: string) => [`the socket has been down for ${cap} queued messages — the oldest was dropped.`, `State sync keeps the newest; if every message matters, gate writes on the status key.`],
  'stream-sse-send': () => [`an http(s) stream is receive-only — SSE has no client channel.`, `Send with data-vd-fetch, or use a ws:// url and the same send key.`],
  'stream-target-missing': (detail: string) => [`"${detail}" matched no element to swap into.`],
  'stream-unavailable': (api: string) => [`${api} is unavailable here, so the stream never opened.`],
  'stream-url-refused': (detail: string) => [`"${detail}" is not a URL this page may stream from.`, `It must be http(s) or ws(s) and same-origin, unless the origin is in remote({ allowedOrigins }).`],
  'scroll-to-missing': () => [`the scroll target matched nothing.`],
  'scroll-progress-bad-source': (given) => [
    `"${given}" is not something scroll-progress can measure.`,
    'Leave it off for this element\u2019s own travel, or write "document" for the whole page.',
  ],
  'elect-no-id': () => [`this section has no id, so the election has nothing to name.`, `Give the element an id — the state key holds the active id.`],
  'sensor-unknown-suffix': (flag: string, sensor: string, known: string) => [`:${flag} is not a ${sensor} suffix — the key would silently include it.`, `The ${sensor} suffixes are: ${known}.`],
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
  'teardown-threw': (detail: string) => [`a teardown threw: ${detail}`, 'The element was still released; a teardown should only undo what its directive set up.'],
  'undeclared-write': (key: string) => [`"${key}" was not declared by the state it landed in.`, `Declare it in data-vd-state.`],
  'unknown-action': (name, known) => [
    `"${name}" is not a pure function or a registered action.`,
    known ? `Registered actions: ${known}. Add one with wireActions.` : 'Register it with wireActions({ ' + name + ': fn }).',
  ],
  'action-outside-handler': (name) => [
    `${name}() ran where there is no event — actions run only while a handler is firing.`,
    'A reflection re-runs whenever its inputs change, so an action there would fire over and over.',
  ],
  'action-no-element': (name) => [`${name}() had no element to build a context from.`],
  'in-view-bad-line': (line) => [
    `"${line}" is not a trigger line.`,
    'Write a fraction or a percentage of the viewport height, like data-vd-in-view="seen 0.3".',
  ],
  'unknown-directive': (suffix: string, declined?: string) => [
    `nothing wired provides "${suffix}".`,
    declined ? 'The loader declined it — check the name, or its alias map.' : 'Wire its pack, or check the name.',
  ],
  'payload-not-walkable': (name) => [
    `${name} is a single value, so it has no properties to read.`,
    'Trigger variables are primitives on purpose — write the whole value, or compute from it.',
  ],
  'payload-outside-handler': (name) => [
    `${name} has no event to read: trigger variables exist only while a handler is running.`,
    'Write it in a data-vd-on-* handler, or put the value into state there and read the key here.',
  ],
  'payload-not-primitive': (name, base) => [
    `a payload getter for ${name}${base ? ` on "${base}"` : ''} returned an object.`,
    'Getters return primitives — a walkable value hands attribute text the DOM API they exist to keep out.',
  ],
  'unknown-payload-var': (name, offered, near) => [
    `${name} is not something this event carries.`,
    `${near ? `Did you mean ${near}? ` : ''}This one offers ${offered}.`,
  ],
  'watch-not-object': () => [
    'data-vd-watch takes a braced object of key: { writes }.',
    'Write data-vd-watch="{ q: { page: 1 } }".',
  ],
  'watch-entry-not-object': (key) => [`the value watched for "${key}" must be a braced assignments object.`],
  'watch-loop': () => [
    'a watch kept changing a key it watches, so it was stopped.',
    'Write to keys the watch does not read, or the two chase each other.',
  ],
  'unknown-key': (head: string) => [`no ancestor state declares "${head}".`, `Reads answer undefined.`],
  /* ── the directives motion PACK's own refusals ─────────────────────────────────────────────── */
  /**
   * Groups, split and the pack's own options — the PACK's codes, raised by `@verajs/directives/motion`. Motion's own
   * refusals (what `@verajs/motion` itself raises) live in that package's table, which the pack registers with this
   * engine at wiring time (`seams.prose`, development only), so a standalone motion embedder reads the same sentences.
   */
  'motion-presets-wired-twice': () => [
    'presets is wired twice — the second registration cannot override the first.',
    'presets(table) already includes the shipped ten; wire that one alone.',
  ],
  'motion-sensor-self-feed': (when: string) => [
    `this element senses its own position (in-view) while "when: '${when}'" gates an animation that MOVES it — if the sensor feeds that gate, the trigger line can sit inside the element's own travel and oscillate.`,
    `Put data-vd-in-view on an untransformed wrapper; the box then animates without ever crossing its own line.`,
  ],
  'motion-group-on-member': () => [
    'motion-group configures a REGION for descendants; the element carrying it animates in the region above.',
  ],
  'motion-group-not-object': () => ['motion-group takes a braced object.'],
  'motion-group-parse-failed': (detail) => [`motion-group could not parse: ${detail}`],
  'motion-group-axis': (key) => [`motion-group ${key}: is 'vertical' or 'horizontal'.`],
  'motion-group-scroller': (key) => [`motion-group ${key}: is a selector matching one element on the page.`],
  'motion-group-duration': (key) => [`motion-group ${key}: must be a number from 0 to 3600.`],
  'motion-breakpoint-unusable': (name) => [`breakpoint ${name} is not a usable [min, max]; ignoring it.`],
  'motion-unknown-option': (key) => [`motion() was given "${key}", which is not an option this pack has.`],
  'motion-option-not-boolean': (key, given) => [`${key} must be true or false, not ${given}; using the default.`],
  'motion-option-unusable': (name, given, fallback) => [
    `${name} ${given} is not usable; ${fallback ? `using ${fallback}.` : 'ignoring it.'}`,
  ],
  'motion-onprogress-not-fn': () => ['onProgress is not a function; ignoring it.'],
  'motion-onprogress-threw': () => ['onProgress threw, so it is being ignored from here on.'],
  'split-no-animation': () => [
    'split needs an animation to give the pieces.',
    'Put a data-vd-motion on this element.',
  ],
  'split-pin-dropped': () => [
    'pin would move to each piece when the text is split, and a piece cannot hold the container.',
    'Put it on a wrapper around this element instead. It is dropped here.',
  ],
  'split-bad-mode': (mode) => [`split takes chars, words or lines — not "${mode}".`],
  'split-has-comments': () => [
    'split needs plain text, not comments.',
    'A comment is how other libraries anchor themselves in a page, so splitting would destroy it.',
  ],
  'split-has-markup': () => ['split needs plain text, not nested markup.'],
  'split-bidi-opposed': () => [
    "split: this text runs against the paragraph's direction, and split pieces keep source order — " +
    'the bidi reordering that makes it read correctly is lost.',
    'Split an element whose direction matches the text instead.',
  ],
  'split-too-many': (mode, count, cap) => [
    `split="${mode}" would make ${count} pieces, over the ${cap} limit.`,
  ],
};
