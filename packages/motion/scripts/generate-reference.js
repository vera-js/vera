/**
 * Generates docs/ATTRIBUTE-REFERENCE.md from schema.ts and the shipped modules.
 *
 * The attributes are a public API with three authors — people, GUI editors,
 * and AI agents — so the reference has to be right. Writing it by hand
 * guarantees it drifts from the schema the moment a property is added, which is
 * the exact failure principle #5 exists to prevent. So it is generated, and
 * `npm run check:reference` fails the build if it is stale.
 *
 * **Generated is not the same as complete.** This read `PROPERTIES` and
 * `SETTINGS` — the built-in tables — and looped over `CATEGORIES`, all three
 * static. When `frame` and the paint properties left those tables for
 * `@verajs/motion/sequence` and `@verajs/motion/paint`, the reference lost six
 * properties and five settings and said `23 properties` with total confidence.
 * `check:reference` could not see it: it regenerates from the same tables and
 * diffs, so it proves the file matches the generator and never that the
 * generator matches the API.
 *
 * So the modules are wired here and everything is read from the live registry.
 * Ownership is **observed** — wire one module, see which attributes appeared —
 * rather than declared in a list beside it, because a list beside it is the
 * thing that just failed.
 */
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'docs/ATTRIBUTE-REFERENCE.md');

const {
  PRESETS, CATEGORIES, UNITS, POSITION_UNITS, ATTRIBUTE_PREFIX,
  MAX_KEYFRAMES, MAX_BANDS,
  wireMotion, properties, settings,
} = await import('../src/modules/schema.ts');

const esc = (s) => String(s).replace(/\|/g, '\\|');
const code = (s) => `\`${s}\``;

/**
 * Every module this package ships, in the order their sections should read.
 * A module added to `package.json` and not to this list is caught by audit
 * rule 12 rather than by someone noticing.
 */
const MODULES = [
  { specifier: '@verajs/motion/easings', wirable: (await import('../src/easings.ts')).easings, doc: 'modules/easings.md' },
  { specifier: '@verajs/motion/paint', wirable: (await import('../src/paint.ts')).paint, doc: 'modules/paint.md' },
  { specifier: '@verajs/motion/path', wirable: (await import('../src/path.ts')).path, doc: 'modules/path.md' },
  { specifier: '@verajs/motion/split', wirable: (await import('../src/split.ts')).split, doc: 'modules/split.md' },
  { specifier: '@verajs/motion/sequence', wirable: (await import('../src/sequence.ts')).sequence, doc: 'modules/sequence.md' },
];

/**
 * Which module each attribute came from, read off the definition's own `from`.
 *
 * This used to be *observed* — wire one module at a time and diff the registry
 * — because a definition could not say where it came from. `PropertyDef.from`
 * exists now (added for the GUI panel that had the same problem and no such
 * workaround available), so the answer is asked rather than deduced, and audit
 * rule 29 holds every module definition to declaring it. Still nothing here
 * names an attribute: a module that gains one gains a correct row unedited.
 */
for (const m of MODULES) wireMotion(m.wirable);
const BY_SPECIFIER = new Map(MODULES.map((m) => [m.specifier, m]));
const owner = new Map([
  ...properties().map((p) => [`p:${p.attribute}`, BY_SPECIFIER.get(p.from) ?? null]),
  ...settings().map((s) => [`s:${s.attribute}`, BY_SPECIFIER.get(s.from) ?? null]),
].filter(([, m]) => m));

const ALL_PROPERTIES = properties();
const ALL_SETTINGS = settings();

/** `core`, or a link to the module's own doc. The column exists because an
 * attribute that needs an import nobody mentioned is worse than an undocumented
 * one: it is written, it does nothing, and nothing explains why. */
const from = (key) => {
  const m = owner.get(key);
  return m ? `[${code(m.specifier)}](${m.doc})` : 'core';
};

const byCategory = new Map();
for (const p of ALL_PROPERTIES) {
  if (!byCategory.has(p.category)) byCategory.set(p.category, []);
  byCategory.get(p.category).push(p);
}

/**
 * `CATEGORIES` is the built-in list, so a module's category is not in it —
 * `paint` and `image` were dropped silently by a loop over it. Declared order
 * first, then whatever else exists, so adding a module appends a section.
 */
const categoryOrder = [...CATEGORIES];
for (const p of ALL_PROPERTIES) if (!categoryOrder.includes(p.category)) categoryOrder.push(p.category);

/** The module a whole category belongs to, or null when it is core's. */
const categoryModule = (props) => {
  const owners = new Set(props.map((p) => owner.get(`p:${p.attribute}`)));
  return owners.size === 1 ? ([...owners][0] ?? null) : null;
};

const CATEGORY_BLURB = {
  transform: 'Composed into a single `transform` string, in the order listed here. CSS transform functions do not commute, so this order is fixed by the schema rather than by the order you write the attributes.',
  filter: 'Composed into a single `filter` string.',
  border: 'Written as individual CSS properties.',
  svgPath: 'Drives `offset-distance`. Set `data-vm-path-selector` to the `<path>` whose shape to follow.',
  image: 'Drives a `<canvas>` rather than a style. Requires `data-vm-frame-url` and `data-vm-frame-count`. Frames are drawn to fill the canvas\'s `width`/`height` **attributes**, which default to 300×150 whatever CSS says — set them to the frames\' own size. The module is wired, not loaded on demand — being synchronous is what removed a class of bug the dynamic-import version had.',
  paint: 'Written as individual CSS properties, and **not interpolated**. Each authored value takes a slot, the ordinary numeric curve steps between slots, and the value is written as a string — CSS transitions do the animating, which is what `inertia` already sets up. Any colour, gradient or shadow the engine accepts is valid, because `CSS.supports()` is the parser; `url()` is refused, since an attribute must not be able to make a request.',
};

const lines = [];
const w = (s = '') => lines.push(s);

w('# Attribute reference');
w();
w('> **Generated from `src/modules/schema.ts` and the shipped modules — do not edit by hand.**');
w('> Run `npm run reference` to regenerate. `npm run check:reference` fails if it is stale.');
w();
w('Every attribute is namespaced ' + code(ATTRIBUTE_PREFIX) + '. An element must carry the bare');
w(code(ATTRIBUTE_PREFIX) + ' marker to be picked up at all — CSS has no attribute-prefix selector, so');
w('the marker is what lets the runtime find animated elements without walking the whole document.');
w();
w('**An HTML element.** Every measurement here is `offsetTop`, `offsetHeight` and `offsetParent`,');
w('which no SVG interface has — so a marked `<rect>` is refused rather than animated to');
w('`translateY(NaNpx)`, which is what it used to be. Animate a wrapper around the `<svg>` instead.');
w('The element the instance was given as its `root` **is** included, marker and all: a section can');
w('fade in and stagger its own children.');
w();
w('**Values are bounded at a billion.** Not because engines refuse more \u2014 re-measured 2026-09-01,');
w('all three accept `translateY(1e+21px)`, exponential spelling and all, and this reference used to');
w('say otherwise. What actually breaks past the bound is arithmetic and engine saturation: rounding');
w('to three decimals multiplies by 1000, which loses integer precision above ~9e12, and Chromium');
w("silently clamps a transform's translation near 3.36e7px, so an enormous value renders as a");
w('different number than was written. A billion stays under all of that, leaves room for an');
w('overshooting curve, and no layout is a billion pixels.');
w();

w('## Grammar');
w();
w('```');
w('data-vm                              marker (required), or a preset name');
w('data-vm-<property>="v"               animate to v');
w('data-vm-<property>="p v, p v, …"     keyframes: position then value');
w('data-vm-<property>="… ; [a-b]: …"    a width band, merged over the base');
w('data-vm-<property>-<name>            the same, by a registered name');
w('data-vm-<setting>="v"                element-level setting');
w('```');
w();
w('- **A bare value is the end of the timeline.** `data-vm-opacity="0"` fades *to* 0, and the');
w('  missing end is filled from the property\'s resting value.');
w('- **A position always carries a unit; a value may or may not.** That is what makes a lone number');
w('  unambiguously a value, so the two forms can share one attribute.');
w(`- **Position units:** ${POSITION_UNITS.map(code).join(', ')}. **Value units** are per-property — see below.`);
w('  The two are independent: `data-vm-rotate="-200px 0deg, 100% 720deg"` is valid.');
w(`- **Up to ${MAX_KEYFRAMES} keyframes**, and up to ${MAX_BANDS} width bands, per attribute. There is no *midpoint* limit — the old two-midpoint cap is gone — but there is a ceiling, and going over it is reported rather than silently truncated.`);
w('- **Width bands merge onto the base.** `"0% 0px, 100% 100px; [0-500]: 100% 20px"` keeps the');
w('  start and overrides only the end. A band keyframe at a new position is added.');
w('- **`[a-b]` is closed, `[a+]` has no ceiling.** An open bottom is `[0-b]`, which cannot be');
w('  misread as a negative number.');
w('- **Bands are inclusive at both ends, so they can overlap — and the last one written wins.**');
w('  `[0-700]` and `[700+]` is the obvious way to write a partition and both match at exactly');
w('  700; the `[700+]` applies there because it comes second. Write `[0-699]` if you want the');
w('  edge to belong to the lower band. Overlap is allowed rather than refused, because a');
w('  deliberate `[0-900]` base with a `[0-500]` correction over it is a reasonable thing to write.');
w('- **A name is only an alias for a range**, registered on the instance:');
w('  `createMotion({ breakpoints: { phone: [0, 500] } })` then `data-vm-opacity-phone="0"`.');
w('- **One bad entry drops itself, not the property.** `"0% 0, junk, 100% 1"` keeps two keyframes.');
w();
w('### Timeline positions');
w();
w('`0%` is the moment the element begins entering the scroll window; `100%` is the moment it has');
w('completely left. The scroll window is the element\'s own size plus the viewport, so an element');
w('animates across rather more scrolling than its own height — and the measure is normalised per');
w('element, which is why one preset looks right on a badge and on a full-bleed hero.');
w();
w('This is what CSS means by a percentage in `animation-range`, whose default range is `cover` —');
w('the same quantity. Assuming CSS semantics here gives the correct behaviour.');
w();
w('Positions outside `0–100%` extrapolate, and negatives are written plainly:');
w();
w('```html');
w('<div data-vm data-vm-opacity="-50% 0, 25% 1">   <!-- starts half a window early -->');
w('<div data-vm data-vm-rotate="0% 0deg, 150% 90deg">  <!-- exits mid-flight, never reaching 90 -->');
w('```');
w();
w('**Prefer `%`.** It is geometry-free, so it never needs recomputing. The length units are for the');
w('cases percentages cannot express — `"-30vh 0"` means "half a viewport before it enters" regardless');
w('of how tall the element is. Curves using them are rebuilt on resize, which costs nothing on a page');
w('that does not use them.');
w();
w('### The one readability trap');
w();
w('```html');
w('data-vm-translate-y="50% 50%"');
w('                       ↑    └── value → 50% of the element\'s own height (CSS)');
w('                       └─────── position → 50% through the scroll window');
w('```');
w();
w('Never ambiguous to the parser — the position is always first — and both readings are correct for');
w('their slot. CSS has the same overlap between `animation-range: cover 50%` and `translateY(50%)`.');
w();

w('## Modules');
w();
w('Some of the attribute surface ships as separate imports, because most pages never use them and');
w('bytes are a correctness concern here. Each is a descriptor handed to `wireMotion` — a module');
w('never registers itself.');
w();
w('**An attribute whose module is not wired does nothing** and is reported in `instance.rejected`.');
w();
w('| module | adds | documentation |');
w('|---|---|---|');
for (const m of MODULES) {
  const props = ALL_PROPERTIES.filter((p) => owner.get(`p:${p.attribute}`) === m).map((p) => code(p.attribute));
  const sets = ALL_SETTINGS.filter((s) => owner.get(`s:${s.attribute}`) === m).map((s) => code(s.attribute));
  /**
   * `easings` registers neither, and listing only what a module *adds to the
   * tables* is how it stayed invisible here: an insert-only module has no row
   * to appear in, so the reference never mentioned it at all while `ease`
   * silently did nothing without it.
   */
  const adds = [...props, ...sets].join(', ') || 'no attributes of its own — it makes `ease` values other than `linear` work';
  w(`| ${code(m.specifier)} | ${adds} | [${m.doc.split('/').pop().replace('.md', '')}](${m.doc}) |`);
}
w();

w('## Properties');
w();
w(`Units: ${UNITS.filter(Boolean).map(code).join(', ')}, or none.`);
w();
for (const category of categoryOrder) {
  const props = byCategory.get(category);
  if (!props?.length) continue;
  w(`### ${category}`);
  w();
  if (CATEGORY_BLURB[category]) { w(CATEGORY_BLURB[category]); w(); }
  const m = categoryModule(props);
  if (m) {
    w(`**A separate module.** Nothing here works until it is wired — the attribute parses, finds no`);
    w(`property by that name, and is reported in \`rejected\`.`);
    w();
    w('```js');
    w(`import { createMotion, wireMotion } from '@verajs/motion';`);
    w(`import { ${m.specifier.split('/').pop()} } from '${m.specifier}';`);
    w();
    w(`wireMotion(${m.specifier.split('/').pop()});`);
    w('```');
    w();
    w(`Full documentation: [${m.specifier}](${m.doc}).`);
    w();
  }
  w('| attribute | CSS | units | range | resting value | from |');
  w('|---|---|---|---|---|---|');
  for (const p of props) {
    const css = p.cssFunction ? `${p.cssFunction}()` : p.cssProperty ? p.cssProperty : '—';
    const units = p.units.filter(Boolean).length ? p.units.filter(Boolean).map(code).join(' ') : '—';
    const min = p.min ?? null, max = p.max ?? null;
    const range = min === null && max === null ? '—'
      : min !== null && max !== null ? `${min} … ${max}`
      : min !== null ? `≥ ${min}` : `≤ ${max}`;
    /**
     * A property with its own `parse` has no resting value an author could
     * write: paint's `initial: 0` is a slot index, and printing it in a column
     * headed "resting value" says the colour rests at zero.
     */
    const initial = p.parse ? '—' : p.initial;
    w(`| ${code('data-vm-' + p.attribute)} | ${code(css)} | ${units} | ${range} | ${initial} | ${from(`p:${p.attribute}`)} |`);
  }
  w();
}

w('## Settings');
w();
w('Element-level. Property and setting names are deliberately disjoint, so `data-vm-<name>`');
w('always resolves unambiguously.');
w();
w('Every value is validated, and a numeric setting is range-checked exactly as a property value is —');
w('an attribute is untrusted whichever slot it fills. A value outside its range is **dropped**, so the');
w('instance default applies, and the attribute name appears in `rejected`.');
w();
w('| attribute | type | range | from | notes |');
w('|---|---|---|---|---|');
const SETTING_NOTE = {
  inertia: 'How much the element resists the position scroll says it should be at, in seconds. `0` tracks scroll exactly. Default `0.1` — see **Two easings** below.',
  'transform-inertia': 'Overrides `inertia` for transforms only, so one element can move fast and fade slowly.',
  'filter-inertia': 'Overrides `inertia` for filters only.',
  'inertia-ease': 'Timing function of the **catch-up**, handed to CSS. Because the target is rewritten every frame, this is effectively a stiffness control — see **Two easings**.',
  perspective: 'Depth for the 3D properties, as a distance from the viewer. **`translate-z` does nothing without it** — measured, `translateZ(200px)` leaves a 100x100 box at 100x100 with no perspective and doubles it with one. `rotate-x` and `rotate-y` work either way but read as flat squashing without it. Applied as the `perspective()` transform function on the element itself, so it needs no cooperation from surrounding markup. A `translate-z` with **neither** this nor a CSS `perspective` on an ancestor is reported in `rejected` — the sentence above was measured fact here for as long as the attribute existed while the runtime wrote `translateZ()` in silence, which is the worst of both. The value itself must be a **non-negative length** — a negative one or a percentage is refused, because CSS rejects `perspective()` for either and this function composes at the *front* of the transform, so an invalid one drops the element\'s translate, rotate and scale with it.',
  pin: 'Hold the element against the leading edge of the viewport at this offset while its animation runs — `top` for a vertical instance, `inset-inline-start` for a horizontal one, so a right-to-left scroller pins against its own leading edge. `position: sticky` underneath, so how long it holds is its containing block\'s extent along that axis. A clipping ancestor, or a containing block with no room to travel, turns sticky off entirely; both are reported in `rejected`.',
  ease: 'Timing function of the **curve** — how value relates to scroll position. Default `linear`. Applies per segment, as `@keyframes` does. **Anything other than `linear` requires [`@verajs/motion/easings`](modules/easings.md)**; without it the runtime warns once and every curve stays straight. Not to be confused with `inertia-ease`, which is handed to CSS and needs no module.',
  split: 'Splits the element\'s text into `chars`, `words` or `lines` so each piece animates on its own. The pieces inherit the animation attributes; the element keeps `stagger`, which is what cascades them. Plain text only: nested markup is refused with a warning, and so are comments — a comment node is how several frameworks anchor themselves in a page. Refused too when the element has **no animation attributes to give the pieces**: splitting then hides the text behind `aria-hidden` and buys nothing.',
  stagger: 'Goes on a **parent**. Offsets each animated descendant\'s keyframes by `index x value`, so a row arrives one after another instead of in unison. `%` by default; any position unit works and is normalised the same way a keyframe position is. Negative runs the row in reverse. **Scroll-driven descendants only** — it offsets a scroll timeline, and `data-vm-when` replaces the scroll driver, so a state-driven child takes no offset and is reported in `rejected`. A host with **no animated descendants at all** is reported as well, marked or not — it is on an unmarked parent by design, which is what made that the quiet case.',
  'run-once': 'Play through once and latch. Means the same on either driver — later scrolling, or the selector no longer matching, will not walk it back.',
  when: 'Drive this element from a selector match instead of from scroll. At the animation\'s end while the element matches, at its start while it does not. **Replaces** the scroll driver — an element is one or the other, never both. A selector **list** is accepted and means what it looks like: while either matches. `:has()` is refused. Re-evaluated when an attribute changes and only then, so `:hover`, `:focus`, `:active`, `:target`, `:checked` and friends cannot be seen at all — a selector using one is **refused**, and the element animates on scroll instead. Use CSS for those. Because it replaces the driver, what depended on the driver goes with it: `ease` and `stagger` are refused on a `when` element, and the *page is too short to finish this* diagnostic never fires for one — it reaches its end when the selector matches, whatever the page height.',
  'will-change': 'Hint the compositor, naming the properties this element actually animates. Use sparingly — it costs memory per element.',
  'transform-origin': 'CSS `transform-origin`, and the real grammar rather than "one to three keywords or lengths": `[left|center|right|<len>] [top|center|bottom|<len>]`, or two keywords in **either** order with one per axis, plus an optional third value that must be a length. So `top bottom`, `top top` and `center center center` are refused, and — read off three engines rather than the specification — `10px top` is legal where `top 10px` is not.',
  'path-selector': 'Selects the `<path>` a `path` animation follows. Resolved within the element\'s own root, so it works inside a shadow root. If it matches nothing, matches an element with no `d`, or matches a `d` the sanitiser will not pass through, `path` does nothing and `rejected` says which.',
  'path-rotate': 'Orientation along the path. `auto` follows the tangent; default keeps it upright.',
  'frame-url': 'Base URL of an image sequence, ending in a slash. Frames are fetched as `<url><n>.jpg`, **numbered from 1** and zero-padded to `frame-pad` digits — so `/seq/` with the default padding asks for `/seq/0001.jpg`. The extension comes from `frame-ext`, default `jpg`. **Same-origin unless the instance allowlists otherwise** — an attribute cannot widen this.',
  'frame-count': 'How many frames the sequence has.',
  'frame-ext': 'Frame file extension, without the dot. One of `jpg`, `jpeg`, `png`, `webp`, `avif`. Default `jpg`. A sequence is the heaviest thing this library loads, and `webp` is typically 30-50% smaller than `jpg` at the same quality.',
  'frame-pad': 'Zero-padding width of the frame number in the filename. Default 4 → `0001.jpg`.',
  'frame-tween': 'Cross-fade adjacent frames instead of snapping to the nearest. A bare attribute means true. **Off by default, for performance**: snapping redraws only when the rounded frame changes, cross-fading redraws whenever the position moves and draws twice when it does. Worth it below roughly 100 frames, where stepping is visible; a dense sequence does not need it. The blend is positional — a scroll that stops mid-way holds a blend rather than finishing one.',
};
for (const s of ALL_SETTINGS) {
  const range = s.min !== undefined || s.max !== undefined
    ? `${s.min ?? ''} … ${s.max ?? ''}`
    : s.allowed ? s.allowed.map(code).join(' ') : '—';
  w(`| ${code('data-vm-' + s.attribute)} | ${code(s.type)} | ${esc(range)} | ${from(`s:${s.attribute}`)} | ${esc(SETTING_NOTE[s.attribute] ?? '')} |`);
}
w();

w('**A `cubic-bezier()` needs its `x` co-ordinates in 0-1**, in either slot. `y` may go anywhere —');
w('a control point above 1 or below 0 is how a springy curve overshoots and settles back — but an');
w('`x` outside the range is not a function of progress at all, and every engine refuses it. Accepted');
w('here it would reach `inertia-ease` verbatim, build a `transition` the CSSOM drops whole, and leave');
w('**no transition at all**, which is inertia silently off. Refused instead.');
w();
w('## Two easings, and what each one is for');
w();
w('`ease` and `inertia-ease` take the same vocabulary and do entirely different jobs. They are the');
w('one thing in this API most likely to be misread, so:');
w();
w('| | `ease` | `inertia-ease` |');
w('|---|---|---|');
w('| shapes | the **curve** — value against scroll position | the **catch-up** — how the element reaches that value |');
w('| evaluated by | this library, once per animation per frame | CSS, on the compositor |');
w('| default | `linear` | `cubic-bezier(0.33, 1, 0.68, 1)` |');
w('| effect at `inertia: 0` | full | **none** — there is no transition to shape |');
w('| effect on a `when` element | **none** — it sits at one endpoint, never between keyframes | full |');
w();
w('**Both of those "none" cells are refused, not merely true.** Each was documented here and');
w('accepted in silence by the runtime, which is the worst of both: the reference said the attribute');
w('does nothing and the library let you write it anyway. `ease` on a `data-vm-when` element');
w('and `inertia-ease` at an effective `inertia` of 0 both land in `instance.rejected`, naming the one');
w('that does work instead. `inertia-ease` counts the instance default when the element sets no');
w('`inertia` of its own, and stays quiet when a `transform-inertia` or `filter-inertia` above zero');
w('brings the catch-up back.');
w();
w('```html');
w('<div data-vm');
w('     data-vm-translate-y="0% 0px, 100% 500px"');
w('     data-vm-ease="ease-in"             <!-- creeps, then rushes -->');
w('     data-vm-inertia="0.1"              <!-- how much it trails -->');
w('     data-vm-inertia-ease="ease-out">   <!-- shape of the trailing -->');
w('```');
w();
w('**Why the curve cannot be CSS.** A `transition` runs on a timer and has no way to ask where the');
w('scrollbar is, so the value has to be computed from scroll position by this library either way.');
w('The one CSS mechanism that does know is `animation-timeline`, and an animation overrides a');
w('transition — so using it would mean giving up inertia entirely. Measured in Chromium and WebKit;');
w('Firefox has no `animation-timeline` at all.');
w();
w('**What `inertia-ease` really controls.** The runtime rewrites the transition\'s target every frame,');
w('so only the first ~17% of the curve is ever traversed. What matters is its slope near the start,');
w('which makes it a stiffness control rather than a shape one. Measured at `inertia: 0.1`:');
w();
w('| `inertia-ease` | trails the scroll by |');
w('|---|---|');
w('| `cubic-bezier(0.33, 1, 0.68, 1)` (default) | 8px |');
w('| `ease-out` | 17px |');
w('| `linear` | 30px |');
w('| `ease-in-out` | 94px |');
w('| `ease-in` | 113px |');
w();
w('A control point above `1` — `cubic-bezier(0.34, 1.56, 0.64, 1)` — overshoots and settles back, in');
w('either slot. On `ease` that means overshooting against **scroll position**; on `inertia-ease` it is');
w('a spring in the catch-up.');
w();
w('### One name for this idea');
w();
w('The thing `inertia` controls is called momentum, damping, smoothing, `scrub` and `lerp` by');
w('different tools. **Here it is inertia, and only inertia** — there is no `momentum`, `damping` or');
w('`scrub` attribute, and there will not be. Inertia is the physically apt term: a property you set');
w('that governs resistance to a change in motion, where momentum is an instantaneous quantity that');
w('could not be a constant. Its shape is `inertia-ease`, and its per-category overrides are');
w('`transform-inertia` and `filter-inertia`.');
w();

w('## Presets');
w();
w('A name on the marker attribute. Presets expand into ordinary keyframes, so they are never a');
w('special case — they produce exactly what writing the attributes by hand would. An explicit');
w('attribute for the same property replaces the preset\'s contribution for that property.');
w();
w('A **band** does not. `data-vm="fade"` with');
w('`data-vm-opacity-mobile="0% 0.5, 100% 1"` fades everywhere and fades differently below');
w('that width — the suffixed attribute says where the animation differs, not that the preset was a');
w('mistake. A band written inline, `data-vm-opacity="[0-700]: 0% 0.5, 100% 1"`, is an');
w('explicit attribute for the property and does replace the preset outright.');
w();
/**
 * `PRESETS` rather than a registry, for the reason `parse.ts` gives: a module
 * cannot register one. Every other table this file reads had to move to the
 * live registry; this is the one that did not need to.
 */
w('| preset | expands to |');
w('|---|---|');
for (const [name, kf] of Object.entries(PRESETS)) {
  const parts = Object.entries(kf).map(([prop, value]) =>
    `${code('data-vm-' + prop + '="' + value + '"')}`);
  w(`| ${code('data-vm="' + name + '"')} | ${esc(parts.join(' · '))} |`);
}
w();

w('## Validation');
w();
w('Attribute values are untrusted input — in a CMS, anyone who can edit a block can set them.');
w('Every value is checked before it reaches the DOM, and **a value that fails is dropped rather than');
w('guessed at**. The rest of the element keeps working.');
w();
w('| what | rule |');
w('|---|---|');
w('| numbers | `-?digits[.digits]` with an optional unit from the allowlist, range-checked against the property |');
w('| units | fixed allowlist per property; anything else is rejected |');
w('| urls | same-origin unless the **instance** allowlists an origin. `javascript:`, `data:`, `blob:`, `vbscript:`, `file:` and protocol-relative are refused |');
w('| selectors | conservative shape only, verified against the browser parser |');
w('| SVG path data | restricted to the alphabet path data can legally contain, and must begin with a moveto |');
w();
w('Nothing resembling `calc()`, `url()`, `var()`, `attr()` or a CSS function survives validation.');
w();
w('**Failures are safe.** A dropped animation leaves content in its natural, readable state — never');
w('hidden, transparent, or translated off-screen.');
w();

const sha = process.env['GIT_SHA'] ?? '';
w('---');
w();
w(`_${ALL_PROPERTIES.length} properties · ${ALL_SETTINGS.length} settings · ${Object.keys(PRESETS).length} presets, across core and ${MODULES.length} modules${sha ? ' · ' + sha : ''}_`);

const text = lines.join('\n') + '\n';

/**
 * The `DESIGN-SPEC.md` §8 registry-count check left with the 2026-09-01 monorepo migration:
 * that document moved to the private portal as a historical snapshot, and a public gate
 * cannot read a private path. If it returns to this package, the check comes back with it —
 * the pre-migration `scripts/generate-reference.js` in the archived repo has it.
 */
if (process.argv.includes('--check')) {
  const current = existsSync(out) ? readFileSync(out, 'utf8') : '';
  if (current !== text) {
    console.error('docs/ATTRIBUTE-REFERENCE.md is stale — run `npm run reference`.');
    process.exit(1);
  }
  console.log('attribute reference is up to date.');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${out} — ${ALL_PROPERTIES.length} properties, ${ALL_SETTINGS.length} settings, ${Object.keys(PRESETS).length} presets`);
}
