/**
 * **`@verajs/motion`'s refusals, keyed by code — DEVELOPMENT ONLY** (code-system phase 4, 2026-10-09). Referenced only
 * behind `__DEV__`, so a production bundle drops it whole. Motion's prose lived in the directives engine's table until
 * now, so `@verajs/motion` used on its own — the embedders it was cut out for — printed a bare code with no sentence
 * even in development. Two readers now: motion's own fallback reporter (`schema.ts`, before any engine is wired), and
 * the directives engine, which the motion pack hands this table at wiring (`seams.prose`) so a refusal reads the same
 * sentence through either route. `scripts/sync-diagnostics.mjs` publishes it as `packages/motion/diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  /**
   * Motion arrived from the retired motion package with a different convention: every refusal
   * funneled through one `motion-refused` code carrying a composed sentence, with a shortened
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
    `Move it: keyframes: { ${key}: … }. The top level holds settings — ease, anchor, scroll, play.`,
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
  'motion-setting-perspective': (where) => [
    `${where}: must be a positive length — zero and negatives are invalid CSS, and an invalid ` +
    'perspective() silently kills the whole transform.',
  ],
  'motion-setting-function': (where) => [
    `${where}: is not a registered function's NAME — bare identifier, no parentheses, never code.`,
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
  'motion-duplicate-position': (where, position) => [
    `${where ? `${where}: ` : ''}two keyframes at ${position} — the later one is used.`,
    'Either a position is written twice, or a positionless stop landed on an explicit 100%. ' +
      'An ALL-positionless list spreads evenly instead, so give every stop a position or none.',
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
  'motion-function-unknown': (name) => [
    `function: '${name}' names no registered function.`,
    `Register it from page code, before elements activate: wireFunctions({ ${name}: (el, p) => { … } }).`,
  ],
  'motion-function-threw': (name, error) => [
    `function '${name}' threw and is disabled for this element. ${error}`,
  ],
  'motion-function-redefined': (name) => [
    `wireFunctions: '${name}' is already registered; the first registration wins.`,
    'Rename one of them — a silent override would leave one module believing its function runs.',
  ],
  'motion-function-not-function': (name, kind) => [
    `wireFunctions: '${name}' is ${kind}, not a function or a { run, setup } module; ignoring it.`,
  ],
  /** The image-sequence tick's five refusals — one code each (they were one code carrying a whole sentence). */
  'motion-sequence-canvas': () => [
    'frame needs a <canvas> element.',
    'Put the sequence on a <canvas>: it draws each frame into one.',
  ],
  'motion-sequence-url': (url) => [
    `frame-url "${url}" is missing or not permitted.`,
    'Give a same-origin frame-url, or allow its origin where the module is wired: sequence({ allowedOrigins: [...] }).',
  ],
  'motion-sequence-count': (count) => [
    `frame-count must be a positive number — got "${count}".`,
    'Write the number of frames in the sequence: frame-count: 120.',
  ],
  'motion-sequence-load': (failed) => [
    `frame-url: nothing loaded, starting with ${failed}.`,
    'frame-url is a PREFIX — check it ends with the folder\'s slash, and that the first frame exists there.',
  ],
  'motion-sequence-context': () => [
    'this canvas has no 2D context.',
    'A canvas already given another context (webgl, bitmaprenderer) cannot give a 2D one — give the sequence its own <canvas>.',
  ],
  'motion-perspective-bad': (perspective) => [
    `perspective: "${perspective}" is not a length CSS will take — it must not be negative or a percentage.`,
    'An invalid perspective() drops the whole transform, so nothing on this element would animate.',
  ],
  'motion-when-blind': (when, blind) => [
    `when: "${when}" uses ${blind}, which this library cannot be told about — it re-reads a ` +
    'selector when an attribute changes, and that state is not an attribute.',
    'Use CSS for it. This element animates on scroll instead.',
  ],
  'motion-pointer-duplicate': (source: string) => [`the pointer chain lists "${source}" twice.`, `Each source may appear once — first-available-wins needs no repeats.`],
  'motion-pointer-rest-token': () => [`"rest" is not a chain entry — it is every chain's implicit floor.`, `Remove it; when nothing is available, the first source's rest value holds.`],
  'motion-pointer-scroll-first': () => [`"scroll" leads the chain, and scroll is always available — nothing after it can ever drive.`, `Put the pointer source first: pointer: 'x, scroll'.`],
  'motion-pointer-unreachable': (tail: string) => [`after "scroll", ${tail} can never drive — scroll is always available.`],
  'motion-pointer-with-scroll': () => [`\`pointer\` and the \`scroll\` setting are two competing drivers.`, `Compose them as a chain instead: pointer: 'x, scroll'.`],
  'motion-pointer-with-stagger': () => [`\`stagger\` does not compose with a pointer source yet (deferred from v1).`],
  'motion-setting-pointer': () => [`pointer takes 'x', 'y' or 'distance', optionally chained with a trailing 'scroll' — like pointer: 'x, scroll'.`],
  'motion-play-with-inertia': () => [
    'play and inertia name the same transition, so only one of them can be in force.',
    'Keep play for a timed playthrough, or inertia for a smoothed scrub.',
  ],
  'motion-inertia-ease-at-zero': () => [
    'inertia-ease does nothing at inertia: 0 — it shapes the catch-up, and 0 means the values ' +
    'track scroll exactly with no transition to shape.',
    'Raise inertia, or use ease.',
  ],
  'motion-stagger-no-descendants': () => [
    'stagger needs animated descendants — it goes on the parent.',
  ],
  'motion-css-overridden': (property: string, got: string) => [
    `an author rule outranks the generated CSS: computed ${property} is ${got}, not this element's generated value — the animation sits still and the cascade is doing exactly what CSS does.`,
    `Find the winning rule in devtools (the generated selectors are 0-2-0, doubled on purpose); lower its specificity, drop the !important, or scope it away from [data-vm-motion] elements.`,
  ],
  'motion-gate-oscillating': (when: string) => [
    `the "when: '${when}'" gate flipped five times in ~a second — a feedback loop (usually: the animation moves the element across its own sensor line). Held at the last state until it settles.`,
    `Sense an untransformed wrapper instead of the animated element, or move the trigger line outside the element's own travel.`,
  ],
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
  'motion-regenerate-failed': () => [
    'a re-measure produced no rules for this element; keeping the previous ones.',
    'This should be unreachable — please report the value that did this.',
  ],
  'motion-inexpressible': () => [
    'this value has no CSS spelling: a composite target (transform or filter) whose properties ' +
    'misalign under one non-linear ease, or a third-party discrete hold.',
    'Give each property its own ease (or align the stops), and CSS carries it.',
  ],
  'motion-unsupported': () => ['required APIs unavailable, animation disabled.'],
  /** Two distinct rule bodies derived one 64-bit name. The second is refused rather than allowed
   *  to overwrite — an element wearing another animation is the failure this prevents. */
  'motion-rule-name-collision': (name) => [
    `two different animations derived the same rule name (${name}), so the second was not applied`,
    'a rule name is the hash of the CSS it names, so this should be unreachable — please report it.',
  ],
  'motion-sequence-origins-not-list': (kind) => [
    `sequence allowedOrigins must be a list, not ${kind}; ignoring it.`,
    'Write one origin as a list of one, for example ["https://cdn.example"].',
  ],
  'motion-sequence-origin-not-url': (entry) => [
    `sequence allowedOrigins entry ${entry} is not a url; ignoring it.`,
    'Write the full origin, for example "https://cdn.example".',
  ],
  'motion-path-no-selector': () => [
    'path needs path-selector — offset-distance travels along nothing without it.',
  ],
  'motion-path-selector-bad': (selector, why) => [`path-selector '${selector}' ${why}`, 'path does nothing.'],
};
