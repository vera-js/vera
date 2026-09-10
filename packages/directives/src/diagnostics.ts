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
  'scroll-progress-bad-source': (given) => [
    `"${given}" is not something scroll-progress can measure.`,
    'Leave it off for this element\u2019s own travel, or write "document" for the whole page.',
  ],
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
  /* ── the motion pack ────────────────────────────────────────────────────────────────────── */
  /**
   * Motion arrived from the retired motion package with a different convention: every refusal
   * funnelled through one `motion-refused` code carrying a composed sentence, with a shortened
   * production variant beside it that still shipped. So its words could not fold and none of them
   * could be addressed — one docs page and one inspector row for the whole pack. `where` is the key
   * path a nested refusal accumulates (`opacity`, then `opacity: [0 50%]`), rendered here so no
   * caller composes the prefix itself.
   */
  'motion-no-value': () => ['motion: no value — name a preset or write an object.'],
  'motion-not-object': () => ['motion: the braced form must be an object of keys.'],
  'motion-keyframes-not-object': () => [
    'motion: keyframes takes an object of properties.',
    "Write keyframes: { opacity: '0% 0, 100% 1' }.",
  ],
  'motion-property-at-top-level': (key) => [
    `${key} is a property, and properties are written inside keyframes.`,
    `Move it: keyframes: { ${key}: … }. The top level holds settings — start, end, ease, anchor.`,
  ],
  'motion-setting-in-keyframes': (key) => [
    `${key} is a setting, and settings are written outside keyframes.`,
    `Move it up one level, beside keyframes rather than inside it.`,
  ],
  'motion-not-html': (tag) => [
    `motion is on a <${tag}>, which this library cannot measure — it reads offsetTop and ` +
    'offsetHeight, which only HTML elements have.',
    'Animate a wrapper around it instead.',
  ],
  'motion-parse-failed': (detail) => [
    `motion: could not parse — ${detail}.`,
    'If a value is text (keyframes, lengths, easings) it has to be quoted.',
  ],
  'motion-preset-unknown': (where, text) => [
    `${where ? `${where}: ` : ''}"${text}" is not a preset any wired pack knows.`,
    'Presets are a pack, so this list is whatever you wired — check that one, not a built-in list.',
  ],
  'motion-presets-wired-twice': () => [
    'presets is wired twice — the second registration cannot override the first.',
    'presets(table) already includes the shipped ten; wire that one alone.',
  ],
  'motion-progress-property-taken': (name) => [
    `${name} is already registered with a different type, so progress written to it will not ` +
    'interpolate — a play on this element snaps instead of easing.',
    'Pick an unregistered name in progress:, or align your own @property registration to <number>.',
  ],
  'motion-pack-unwired': (where, key, pack) => [
    `${where ? `${where}: ` : ''}"${key}" belongs to the ${pack} pack, which is not wired.`,
    `Wire it: wireDirectives([motion, ${pack}]).`,
  ],
  'motion-presets-unwired': (where, text) => [
    `${where ? `${where}: ` : ''}"${text}" needs a preset pack, and none is wired.`,
    "Wire one: wireDirectives([motion, presets]) — or your own.",
  ],
  'motion-preset-pack-broken': (where, text) => [
    `${where ? `${where}: ` : ''}a preset pack failed while resolving "${text}".`,
    'The pack is at fault, not the name — the other wired packs were still asked.',
  ],
  'motion-no-such-key': (where, meant) => [
    `${where}: no such key.`,
    meant ? `Did you mean ${meant}?` : 'Check the spelling, or wire the module that provides it.',
  ],
  'motion-unusable-value': (where) => [`${where}: not a value this key can use.`],
  'motion-quote-the-value': (where, key) => [
    `${where}: quote the value — keyframe strings are text.`,
    `Like ${key}: '0% 0, 100% 1'.`,
  ],
  'motion-nested-needs-frames': (where) => [
    `${where}: the nested form needs frames.`,
    "Like { frames: '0% 0, 100% 1', ease: 'ease-in' }.",
  ],
  'motion-nested-unknown': (where) => [`${where}: not part of the nested form.`],
  'motion-setting-not-plain': (where) => [`${where}: a setting takes a plain value.`],
  'motion-setting-boolean': (where) => [`${where}: must be true or false.`],
  'motion-setting-easing': (where) => [`${where}: is not an easing name or a cubic-bezier().`],
  'motion-setting-origin': (where) => [`${where}: is not a transform-origin.`],
  'motion-setting-offset': (where) => [`${where}: is not a length or a percentage.`],
  'motion-setting-selector': (where) => [
    `${where}: is not a selector this library will use — :has() and a few others are refused.`,
  ],
  'motion-setting-alignment': (where) => [
    `${where}: is not "<edge> <viewport position>".`,
    'One token means the leading edge: \'70%\' is \'start 70%\'.',
  ],
  'motion-setting-range': (where) => [
    `${where}: is not one or two comma-separated positions.`,
    "scroll: '70%, 50%' scrubs between them; with play: they are the in and out thresholds.",
  ],
  'motion-setting-length': (where) => [`${where}: is not a length — use px, rem, em, %, vh or vw.`],
  'motion-setting-number': (where, range) => [`${where}: must be a number${range}.`],
  'motion-setting-progress': (where) => [`${where}: is not a custom property name (--like-this).`],
  'motion-setting-tick': (where) => [
    `${where}: is not a registered tick's NAME — bare identifier, no parentheses, never code.`,
  ],
  'motion-setting-module-refused': (where) => [`${where}: was refused by the module that owns it.`],
  'motion-band-suffix-retired': (property, band) => [
    `a \`-${band}\` key suffix is no longer read — write the band in the value instead.`,
    `keyframes: { ${property}: '…; [${band}]: …' }`,
  ],
  'motion-band-bad': (where, segment) => [`${where ? `${where}: ` : ''}${segment} is not a usable band.`],
  'motion-second-base': (where, segment) => [
    `${where ? `${where}: ` : ''}${segment} — an unbracketed segment is the base, and there is already one.`,
  ],
  'motion-mixed-units': (where, first, used) => [
    `${where}: ${first} and ${used} in one animation; ${used} is used throughout.`,
  ],
  'motion-bad-position': (where, segment, min, max) => [
    `${where ? `${where}: ` : ''}${segment} — the position must be ${min} to ${max}% or a length in vh, vw, px or rem.`,
  ],
  'motion-bad-unit': (where, segment, key, unit, takes) => [
    `${where ? `${where}: ` : ''}${segment} — ${key} does not take ${unit}.`,
    `It takes ${takes || 'a plain number'}.`,
  ],
  'motion-out-of-range': (where, segment, key, low, high) => [
    `${where ? `${where}: ` : ''}${segment} — ${key} takes ${low} to ${high}.`,
  ],
  'motion-past-bound': (where, segment, value, bound) => [
    `${where ? `${where}: ` : ''}${segment} — ${value} is past the bound this library writes; values stop at ${bound}.`,
  ],
  'motion-bad-value': (where, segment) => [
    `${where ? `${where}: ` : ''}${segment} is not a value this property can use.`,
  ],
  'motion-no-keyframes': (where) => [`${where ? `${where}: ` : ''}no keyframes.`],
  'motion-too-many-bands': (where, cap) => [`${where ? `${where}: ` : ''}more than ${cap} bands.`],
  'motion-too-many-keyframes': (where, cap) => [`${where ? `${where}: ` : ''}more than ${cap} keyframes.`],
  'motion-tick-unknown': (name) => [
    `tick: '${name}' names no registered tick.`,
    `Register it from page code, before elements activate: wireTicks({ ${name}: (el, p) => { … } }).`,
  ],
  'motion-tick-threw': (name, error) => [
    `tick '${name}' threw and is disabled for this element. ${error}`,
  ],
  'motion-tick-redefined': (name) => [
    `wireTicks: '${name}' is already registered; the first registration wins.`,
    'Rename one of them — a silent override would leave one module believing its tick runs.',
  ],
  'motion-tick-not-function': (name, kind) => [
    `wireTicks: '${name}' is ${kind}, not a function or a { tick, setup } module; ignoring it.`,
  ],
  'motion-sequence-refused': (why) => [why],
  'motion-perspective-bad': (perspective) => [
    `perspective: "${perspective}" is not a length CSS will take — it must not be negative or a percentage.`,
    'An invalid perspective() drops the whole transform, so nothing on this element would animate.',
  ],
  'motion-when-blind': (when, blind) => [
    `when: "${when}" uses ${blind}, which this library cannot be told about — it re-reads a ` +
    'selector when an attribute changes, and that state is not an attribute.',
    'Use CSS for it. This element animates on scroll instead.',
  ],
  'motion-ease-with-play': () => [
    'ease does nothing on a play — it shapes the curve between keyframes, and a play steps ' +
    'end-to-end without visiting them.',
    'Use inertia-ease to shape the change.',
  ],
  'motion-play-with-inertia': () => [
    'play and inertia name the same transition, so only one of them can be in force.',
    'Keep play for a timed playthrough, or inertia for a smoothed scrub.',
  ],
  'motion-inertia-ease-at-zero': () => [
    'inertia-ease does nothing at inertia: 0 — it shapes the catch-up, and 0 means the values ' +
    'track scroll exactly with no transition to shape.',
    'Raise inertia, or use ease.',
  ],
  'motion-stagger-with-play': () => [
    'stagger does nothing on a play — it offsets a scroll timeline, and a play has none.',
    'Remove one of them; a per-sibling time delay is not built yet.',
  ],
  'motion-stagger-no-descendants': () => [
    'stagger needs animated descendants — it goes on the parent.',
  ],
  'motion-region-on-member': () => [
    'motion-region configures a REGION for descendants; the element carrying it animates in the region above.',
  ],
  'motion-region-not-object': () => ['motion-region takes a braced object.'],
  'motion-region-parse-failed': (detail) => [`motion-region could not parse: ${detail}`],
  'motion-region-axis': (key) => [`motion-region ${key}: is 'vertical' or 'horizontal'.`],
  'motion-region-scroller': (key) => [`motion-region ${key}: is a selector matching one element on the page.`],
  'motion-region-duration': (key) => [`motion-region ${key}: must be a number from 0 to 3600.`],
  'motion-breakpoint-unusable': (name) => [`breakpoint ${name} is not a usable [min, max]; ignoring it.`],
  'motion-unknown-option': (key) => [`motion() was given "${key}", which is not an option this pack has.`],
  'motion-option-not-boolean': (key, given) => [`${key} must be true or false, not ${given}; using the default.`],
  'motion-option-unusable': (name, given, fallback) => [
    `${name} ${given} is not usable; ${fallback ? `using ${fallback}.` : 'ignoring it.'}`,
  ],
  'motion-onprogress-not-fn': () => ['onProgress is not a function; ignoring it.'],
  'motion-onprogress-threw': () => ['onProgress threw, so it is being ignored from here on.'],
  'motion-module-threw': (point) => [`a wired module threw in ${point}; the rest of the chain still ran.`],
  'motion-not-a-module': (given) => [`wiring was given something that is not a vocabulary module: ${given}`],
  'motion-vocabulary-replaced': (key, kind) => [
    `wiring replaced the "${key}" ${kind}, which was already registered.`,
    'The earlier one is gone, for every element on the page.',
  ],
  'motion-vocabulary-factory-threw': (detail) => [`a module factory threw while wiring: ${detail}`],
  'motion-setting-and-property': (key) => [
    `wiring was given "${key}" with both a type and a category.`,
    'A setting declares a type and a property declares a category; one descriptor cannot be both.',
  ],
  'motion-property-writes-nothing': (key) => [
    `wiring was given the property "${key}" with no cssProperty, cssFunction or apply, so it has no way to write anything.`,
  ],
  'motion-paint-slots-full': (cap) => [
    `more than ${cap} distinct paint values on this page; later ones are ignored.`,
    'A slot cannot be reclaimed, so the table is capped.',
  ],
  'motion-paint-slots-recovered': () => ['the paint table was emptied; earlier cap refusals no longer apply.'],
  'motion-unsupported': () => ['required APIs unavailable, animation disabled.'],
  'motion-sequence-origins-not-list': (kind) => [
    `sequence allowedOrigins must be a list, not ${kind}; ignoring it.`,
    'Write one origin as a list of one, for example ["https://cdn.example"].',
  ],
  'motion-sequence-origin-not-url': (entry) => [
    `sequence allowedOrigins entry ${entry} is not a url; ignoring it.`,
    'Write the full origin, for example "https://cdn.example".',
  ],
  'motion-easing-threw': (named) => [`${named}: the easing module threw; the curve is linear.`],
  'motion-easings-module-missing': (named) => [
    `${named} needs the easings module; the curve is linear.`,
    "Wire it: wireDirectives([motion({ easings })]).",
  ],
  'motion-path-no-selector': () => [
    'path needs path-selector — offset-distance travels along nothing without it.',
  ],
  'motion-path-selector-bad': (selector, why) => [`path-selector '${selector}' ${why}`, 'path does nothing.'],
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
