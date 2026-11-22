import { escapeHtml, escapeRawText } from './shim.js';
import { INLINE_HANDLER, NEWLINE_TAKERS, SCRIPT_URL, SCRIPT_URL_ITEM, URL_SINK, JSON_BLOCK, asciiLower, closedRawText, dataBlock, decodeCodePoint, decodeSchemeReferences, normalizeNewlines, thrownMessage } from './escaping.js';
import { decode } from './parse.js';
import { registry } from './registry.js';
import { PROSE, TWINS } from './diagnostics.js';
import { once, own, quoted, ssrMisuse, ssrWarning } from './report.js';
import type { Said } from './report.js';
import { currentRenderingTag } from './stylesheets.js';
import { INSTANCE_ATTRIBUTE, NodeBaseShim, markPending } from './nodes.js';
import type { ElementShim } from './nodes.js';
import type { ScanResult, ScanStart, SsrTemplate } from './types.js';
import { PHASE_END_TAG_OPEN as END_TAG_OPEN, INERT_EDIT as EDIT_INERT, RAW_TEXT_TAGS as RAWTEXT, PHASE_TAG_NAME as TAG_NAME, PHASE_TAG_OPEN as TAG_OPEN, TEXT_ONLY_TAGS as TEXT_ONLY, closersOf, freshScan, isTokenizerSpace as isSpace, depthOf, positionAt, positionOf, rawTextCloserAt as closerAt, scanTag } from './tokenizer.js';

/** Module-local, because serializeValue (the hottest function here) reads it: an imported binding is a live one, which
 *  V8 reaches less directly (CLAUDE.md, measured on the tokenizer's constants). */
const NodeBase = NodeBaseShim;

/**
 * The vera-native template serializer: flattens core's `html` template objects to markup with
 * the renderer's sigil semantics applied server-side.
 *
 *   `?bool=${x}`   -> `bool=""` when truthy, nothing when falsy
 *   `.prop=${x}`   -> on a rendered COMPONENT tag, delivered to the instance the nested scan
 *                     renders (by identity, never markup); on a form control, mirrored to an
 *                     attribute (value/checked/selected); else dropped
 *   `@event=${fn}` -> dropped (behavior is the client's job)
 *   `&ref=${r}`    -> dropped
 *   `attr=${x}`    -> quoted, escaped
 *   text `${x}`    -> escaped; nested templates and arrays flatten; only null/undefined vanish
 *                     (`false` renders the word, as the client and as a JS template literal do —
 *                     measured on both sides; saying otherwise here described a divergence that
 *                     does not exist and would have sent someone hunting a hydration bug)
 *
 * Like the client renderer, analysis is **per template identity**: each call site's frozen
 * `strings` array is classified once into a plan (slot kinds + pre-trimmed static parts), cached
 * in a WeakMap. Rendering a 100-row list re-uses one plan 100 times instead of re-running the
 * sigil regexes per row — the same template-identity architecture, server-side.
 *
 * `keyed()`/`hold()` wrappers are client-renderer constructs — SSR templates use plain `.map`.
 */

/** `.prop` bindings whose server-side truth belongs in an attribute. */
const FORM_ATTRIBUTES = ['value', 'checked', 'selected'];
/**
 * Whether a property binding on `owner` is one this serializer writes. `selectedIndex` is a form property on a
 * `<select>` only — it chooses an option, exactly as `value` does (see `SELECT_MARK`) — and on anything else it is
 * the client's concern, with no markup. The written form and a spread key ask the same question, here.
 */
const isFormProperty = (owner: string, name: string): boolean => FORM_ATTRIBUTES.includes(name) || (owner === 'select' && name === 'selectedIndex');

/**
 * `checked` and `selected` are **boolean** properties; `value` is a string one.
 *
 * The element coerces on assignment, so `.checked=${0}` leaves a browser with `checked === false`
 * while `.value=${0}` leaves it with `"0"`. All three were treated as string-ish here — present
 * unless nullish or exactly `false` — so every falsy-but-not-false value (`0`, `''`, `NaN`) served
 * a **ticked** checkbox against a browser's unticked one, and hydration then had to throw the
 * server's markup away to correct it.
 */
const BOOLEAN_FORM_PROPERTIES = new Set(['checked', 'selected']);

/**
 * …and the elements where that is true.
 *
 * Mirroring `.value` to an attribute exists so hydration can read form state back out of the
 * markup, which only means anything on a form control. Applied to every element, `.value` on a
 * `<b>` wrote `value="…"` server-side where the client sets a plain JS property and no attribute at
 * all — a difference in the rendered DOM for no benefit. Anywhere else a `.prop` is client state,
 * which is what it already was.
 */
const FORM_ELEMENTS = new Set(['input', 'textarea', 'select', 'option']);


/**
 * Whether a character code is the first of a sigil binding's name — `.`, `?`, `@`, `&` or `!` (see `compile`). Codes,
 * not a Set of one-character strings: every hole that opens an attribute value asks, and the Set's lookup was the
 * larger part of what asking cost a compile.
 */
const isSigil = (c: number): boolean => c === 46 || c === 63 || c === 64 || c === 38 || c === 33;
/** Whether a name is an `onX` event binding's (`on`, then an ASCII capital), by codes for the same reason. */
const isEventName = (name: string): boolean => {
  /** The length first: a read past the end is `NaN` to the language and a deoptimization to V8 (measured). */
  if (name.length < 3) return false;
  const c = name.charCodeAt(2);
  return name.charCodeAt(0) === 111 && name.charCodeAt(1) === 110 && c >= 65 && c <= 90;
};
/**
 * Where a sigil or event binding's name is cut from the static before it: at the one whitespace character before the
 * name, which the binding takes with it so a dropped binding leaves no residue (`compile` then trims one more space).
 */
const nameCut = (text: string, nameAt: number): number => (nameAt > 0 && isSpace(text[nameAt - 1]) ? nameAt - 1 : nameAt);
/**
 * Where a sigil or event binding's value ends in a static after its hole: past the closing quote, or, unquoted, at the
 * whitespace or `>` that ends it — or `-1` when it does not end there, and runs on into the next hole. The client
 * drops such an attribute whole, every static and every further hole in its value (`@click="${fn}x"` renders `<a>`), so
 * the server does too; left in, the text was glued to the tag (`<a onClick=${fn}x>` served `<ax>`), and a further hole
 * fell through to the attribute path with the binding's quote already gone, so a value in it could write attributes.
 */
const valueEnd = (text: string, quote: string): number => {
  if (quote) {
    const at = text.indexOf(quote);
    return at === -1 ? -1 : at + 1;
  }
  /** A loop, not a regex search: the value usually ends at once (`@click=${fn}>`), and compile meets this per binding. */
  let i = 0;
  for (let c = text.charCodeAt(0); i < text.length && c !== 32 && c !== 62 && (c < 9 || c > 13 || c === 11); c = text.charCodeAt(++i));
  return i === text.length ? -1 : i;
};
/**
 * The static after a dropped binding's value, from where that value ends. After a closing quote the tokenizer starts the
 * next attribute with no space (`<svg onClick="${fn}"<b>` gives `<svg>` an attribute named `<b`); the binding took the
 * space before it, so one goes back, or that text is glued to the tag name.
 */
const afterValue = (text: string, end: number, quote: string): string => {
  const rest = text.slice(end);
  const c = rest.charCodeAt(0);
  return quote && rest && c !== 32 && c !== 62 && c !== 47 && (c < 9 || c > 13 || c === 11) ? ` ${rest}` : rest;
};
/**
 * **A `?`, `.` or `!` value with statics or several holes is ONE string, joined as the client joins it**: the client
 * parses the attribute, splits its value at the holes, and on each render assigns `statics[0] + text(v0) + statics[1]
 * …` (`nullish` is `''`), so `?hidden="x${false}"` is truthy and `.value="${a} ${b}"` is `"a b"`. The server took the
 * first hole alone and, with a static before it, wrote the binding as a literal attribute (`@click="x() => {}"`: the
 * handler's source in the page). A static here is the attribute value's text, so it is decoded as the parser decodes
 * it — with the one decoder the shim parses markup with. `undefined` when the value is a lone hole, the shape the
 * client gives no statics to and which keeps the value itself (an object, a number), not its text. A joined slot's
 * kind is marked (`JOINED`), so the render loop's plain path never reads `joins`, and every join branch lives out of
 * line, so a template without one carries none of it: inline, the bookkeeping cost compile 3–6% and the first render
 * about 3%, as bytecode size (fresh-process A/B, 2026-11-21). `text` is the static the value ends in, `end` where it
 * ends there (`valueEnd`; -1 for the whole of it).
 */
const closeJoin = (
  joins: Array<readonly string[] | undefined> | undefined, kinds: Kind[], at: number, pieces: string[] | undefined,
  text: string, end: number, quote: string
): Array<readonly string[] | undefined> | undefined => {
  const tail = end === -1 ? text : text.slice(0, quote ? end - 1 : end);
  if (pieces === undefined) {
    if (tail === '') return joins;
    pieces = [''];
  }
  pieces.push(valueText(tail));
  kinds[at] = (kinds[at]! + JOINED) as Kind;
  (joins ??= [])[at] = pieces;
  return joins;
};
/** A static of a sigil binding's value, as the client's parser hands it over. */
const valueText = (text: string): string => decode(normalizeNewlines(text));
/** The value's statics once it has a static before its first hole, or a second hole. */
const leadPieces = (text: string, start: number): string[] => [valueText(text.slice(start))];
const morePieces = (pieces: string[] | undefined, text: string): string[] => {
  pieces ??= [''];
  pieces.push(valueText(text));
  return pieces;
};
const joinValue = (pieces: readonly string[], values: readonly unknown[], i: number): string => {
  let text = pieces[0]!;
  for (let p = 1; p < pieces.length; p++) {
    const value = values[i + p - 1];
    text += (value == null ? '' : `${value}`) + pieces[p]!;
  }
  return text;
};

/**
 * **An expression inside an attribute NAME is refused** — the twin of the client's rule (`nameHole` in the renderer),
 * so the two halves refuse the same templates: inside a tag and outside a value, a hole a name character touches on
 * either side (`<p data-${k}="1">`, `<b ${name}="x">`, `<p ${k}-x>`, `<p a${k}b>`) — never a ref, never the TAG name.
 * Refused at plan time, from statics only: no value ever reaches the message.
 */
const NAME_CHAR_BEFORE = /[^\s"'>=/]$/;
const NAME_CHAR_AFTER = /^(?:[^\s"'>=/]|[ \t\n\f\r]*=)/;
/**
 * A bound `javascript:` URL, refused — said once per process per component and attribute. The VALUE is never printed:
 * it is attacker-shaped by definition, and a server's console is a log pipeline (2026-10-09).
 */
const refusedScriptUrl = (name: string): void => {
  const tag = currentRenderingTag();
  if (once('script-url', `${tag} ${name}`)) console.warn(ssrWarning((tag ? `<${tag}>` : 'the page'), 'script-url', TWINS.scriptUrl(name)));
};
const nameHole = (before: string, after: string): never => {
  const prefix = (/[^\s"'>=/]*$/.exec(before) ?? [''])[0];
  const suffix = (/^[^\s"'>=/]*/.exec(after) ?? [''])[0];
  const value = /^[ \t\n\f\r]*=[ \t\n\f\r]*(?:"([^"]*)("?)|'([^']*)('?)|([^\s>]*))/.exec(after.slice(suffix.length));
  const given =
    value === null ? "''" : value[2] === '"' ? JSON.stringify(value[1]) : value[4] === "'" ? JSON.stringify(value[3]) : value[5] ? JSON.stringify(value[5]) : '…';
  throw own(new Error(ssrMisuse('name-expression', TWINS.nameExpression(`${prefix}${'${…}'}${suffix}`, given))));
};


/** Slot kinds: text, boolean, form-prop, dropped binding, plain attribute. */
const TEXT = 0;
const BOOLEAN = 1;
const FORM_PROP = 2;
const DROPPED = 3;
const ATTRIBUTE = 4;
/** `.prop` on a component tag: delivered to the instance the scan will render, never markup. */
const COMPONENT_PROP = 5;
/** `.innerHTML`/`.textContent` on a plain element: content written after the open tag, the one sanctioned trusted-markup door. */
const CONTENT = 6;
type SlotKind = typeof TEXT | typeof BOOLEAN | typeof FORM_PROP | typeof DROPPED | typeof ATTRIBUTE | typeof COMPONENT_PROP | typeof CONTENT;
/** A `?`, `.` or `!` slot whose value is joined (see `closeJoin`) has its kind plus `JOINED`: the render loop's one test. */
const JOINED = 8;
type Kind = SlotKind | 9 | 10 | 13 | 14;
/** The two content properties the server renders; `innerText`/`outerHTML`/`outerText` stay client-only (README). */
const CONTENT_PROPS = new Set(['innerHTML', 'textContent']);

/**
 * One bound attribute value, compiled once per template — every hole in that value shares it (see `compile`), and the
 * render writes the whole attribute from it, always double-quoted, or not at all.
 */
type Group = {
  readonly name: string;
  readonly open: string;
  readonly serial: number;
  readonly quote: string;
  readonly first: number;
  last: number;
  /** 0: written; 1: never served; 2: a URL sink, checked from the start; 3: an animation value, checked item by item. */
  readonly refuse: 0 | 1 | 2 | 3;
  readonly strip: boolean;
  sole: boolean;
  suffix: string;
  decodedSuffix: string;
};

/** A template's plan: per slot, what it is and everything the render needs to write it — computed once per call site. */
type Plan = {
  readonly parts: string[];
  readonly kinds: Kind[];
  readonly names: string[];
  readonly strip: boolean[];
  readonly owners: string[];
  readonly raws: string[];
  readonly depths: number[];
  readonly texts: boolean[];
  readonly elementPositions: boolean[];
  readonly elements: number[];
  /** Sparse: set for each ATTRIBUTE slot only. */
  readonly groups: Array<Group | undefined>;
  /** Sparse, like `groups`: set for each ATTRIBUTE slot, and read only there. */
  readonly leads: string[];
  readonly decodedLeads: string[];
  /** Sparse: set for each COMPONENT_PROP slot only. */
  readonly urls: Array<boolean | undefined>;
  /** Sparse, read only at a `JOINED` slot: its value's statics (see `closeJoin`); `undefined` for a plan with none. */
  readonly joins: ReadonlyArray<readonly string[] | undefined> | undefined;
  /** Per slot (dense, 0 for every slot that is no style hole): when a style value may skip `styleHole` — see `compile`. */
  readonly styleTails: number[];
};

/** No plan at all — every field absent, which is how `serializeTemplate` tells a forgery from a template. */
type Forged = { readonly [K in keyof Plan]?: undefined };

/** What `compile` answers for data shaped like a template: no plan, so `serializeTemplate` renders it as text. */
const FORGED: Forged = {};
const FORGED_TEXT = `${{}}`;
/** A tagged template literal's strings: an array owning `raw`, which nothing from `JSON.parse` can be (see `compile`). */
const isLiteral = (strings: unknown): strings is TemplateStringsArray => Array.isArray(strings) && Object.hasOwn(strings, 'raw');
/** strings identity -> { parts, kinds, names } — computed once per call site, ever. */
const plans = new WeakMap<TemplateStringsArray, Plan>();
/**
 * strings identity -> foreign depth -> plan, for a template that STARTS inside `<svg>`/`<math>` — an `svg`/`mathml`
 * template, or any template rendered into a foreign-content position. The plan differs because raw text does (see
 * `foreign` in `scanTag`), and the common case — depth 0 — keeps its one lookup.
 */
const foreignPlans = new WeakMap<TemplateStringsArray, Map<number, Plan>>();

/**
 * Gets-or-creates the instance a component-prop slot delivers to, per application state (see
 * `adoption` in `serializeTemplate`). A new instance is registered exactly as `appendChild`
 * registers a component-built child, and its marker text is queued on `state.mark` for the caller
 * to write into the open tag being emitted — the string boundary is crossed by the marker while
 * the values stay on the node, by identity. `prepareInstance` unregisters and unstamps it as it
 * renders, and the end-of-render sweep removes any marker whose tag never rendered.
 */
/** The instances one application of a template delivers properties to — see `adoption` in `serializeTemplate`. */
type Adoption = { readonly instances: Map<number, ElementShim>; mark: string };

/**
 * A registered component's constructor as this DOM runs it: callers have asked `registry.has(tag)` first, and under the
 * shim `HTMLElement` is a shim element, so what it builds is an `ElementShim` rather than the lib's `HTMLElement`.
 */
type ComponentClass = new () => ElementShim;

const claimInstance = (state: Adoption, ordinal: number, tag: string): ElementShim => {
  let node = state.instances.get(ordinal);
  if (node === undefined) {
    node = new (registry.get(tag) as unknown as ComponentClass)();
    node.localName = tag;
    state.mark += ` ${INSTANCE_ATTRIBUTE}="${markPending(node)}"`;
    state.instances.set(ordinal, node);
  }
  return node;
};

/**
 * One delivery, shared by the written form and the spread form. `__proto__` is skipped for the
 * same reason `renderToString`'s own `props` option skips it — `[[Set]]` replaces the element's
 * prototype. What a failed assignment means is decided in the catch below, by the client's rule;
 * `prepareInstance`'s `props` OPTION keeps its stricter throw-on-readonly contract deliberately —
 * an API argument is the caller's explicit data, a template binding is a component boundary.
 */
const deliverProperty = (node: ElementShim, tag: string, name: string, value: unknown): void => {
  if (name === '__proto__') return;
  try {
    /** Any property the component declares, by name: the element is written as the open bag it is to a binding. */
    (node as unknown as Record<string, unknown>)[name] = value;
  } catch (error) {
    /**
     * The CLIENT's rule, applied here so the two halves resolve the same contested state the same
     * way: a getter with NO setter is a refusal — warned by name, the binding ignored, the render
     * carried on, exactly what `init()`'s adoption does — while a setter that THREW is the
     * component's own error and stays one, named against the tag and property rather than as
     * `Cannot set property x of #<Class>`. Diverging here meant one binding produced a page on
     * the client and an empty render server-side.
     */
    let carrier: object | null = node;
    let refusable = false;
    while (carrier !== null) {
      const desc = Object.getOwnPropertyDescriptor(carrier, name);
      if (desc !== undefined) {
        refusable = desc.get !== undefined && desc.set === undefined;
        break;
      }
      carrier = Object.getPrototypeOf(carrier);
    }
    if (refusable) {
      if (once('getter-only-prop', `${tag} ${name}`)) console.warn(ssrWarning(`<${tag}>`, 'getter-only-prop', TWINS.getterOnlyProp(name)));
      return;
    }
    throw own(new TypeError(ssrMisuse('ssr-setter-threw', PROSE['ssr-setter-threw']!(tag, name, quoted(thrownMessage(error)))), { cause: error }));
  }
};


/** Attribute names written into the statics, so a duplicate can be spotted before a render. */
/**
 * Preceded by whitespace, so a **tag name** is not counted as an attribute of itself, and allowed to
 * end the string, because the emitted static of an unfinished tag has no `>` yet — `<b hidden` is
 * how `<b hidden ?hidden=${x}>` arrives here, and its bare `hidden` is exactly the duplicate that
 * has to be seen.
 */
const STATIC_ATTRIBUTE = /\s([a-zA-Z][\w:-]*)(?==|[\s>]|$)/g;

/**
 * An author's static, ready to sit inside the DOUBLE quotes the server writes around every bound value.
 * Only a `"` can end them; an entity stays an entity, because the browser decodes one identically in any
 * quoting.
 */
const forDoubleQuotes = (text: string, quote: string): string => (quote === '"' || !text.includes('"') ? text : text.replaceAll('"', '&#34;'));

/**
 * Whether this static's LAST character — a `>`, which the caller has checked — ends a start tag that takes a leading
 * line feed (`NEWLINE_TAKERS`). Only that position matters: content written as static text after the tag is parsed
 * alike on both sides, while what the next binding writes there arrives on the client through the DOM, which takes
 * nothing. Such a static gets one `\n` of its own, ALWAYS: the parser takes exactly one, so whatever comes first —
 * a value, an empty one, a list, a nested template's static, the next static — arrives as the client has it, and the
 * render does nothing at all (measured: 28 tag × content shapes, 2026-10-07). One byte per such element.
 *
 * Asked of the scan itself — the static minus its `>`, from a copy of the state before it — so a `<pre>` inside an
 * attribute value, a comment or raw text is never mistaken for one. Whether it is HTML is the full scan's answer,
 * after the `>`: a `<pre>` breaks out of `<svg>`. Plan time only.
 */
const takesNewline = (text: string, before: ScanStart | ScanResult): boolean => {
  const at = scanTag(text.slice(0, -1), { ...before, opens: before.opens.slice() });
  return (
    at.inTag && !at.closing && !(at.inValue && at.quote !== '') && at.comment === '' && NEWLINE_TAKERS.has(at.tagName)
  );
};

/**
 * The written form nearly every data block has, `<script type="…">` with nothing else in the tag and no `"` in the type,
 * answered directly — `dataBlock`'s own answer for that shape (its first attribute is that `type`), without its match,
 * which was a tenth of what 0.3.2's compile cost over 0.3.0's (2026-11-20). `undefined` for any other shape, which
 * `dataBlock` reads. Kept here, not in `dataBlock`, which stays the exact twin of the client's.
 */
const writtenDataBlock = (tag: string): boolean | undefined => {
  if (!tag.startsWith('<script type="') || !tag.endsWith('">') || tag.indexOf('"', 14) !== tag.length - 2) return undefined;
  const type = tag.slice(14, -2);
  return !type.includes('&') && JSON_BLOCK.test(type);
};

/**
 * Whether an element of this name is open at the end of a static. A plain loop: `opens.some` with an arrow made a
 * closure at every static of every compile (2026-11-20).
 */
const hasOpen = (opens: readonly { name: string }[], name: string): boolean => {
  for (let k = 0; k < opens.length; k++) if (opens[k]!.name === name) return true;
  return false;
};

/** Where the last start tag left open across statics began (`from`, `at`), and the tag found so far (`found`). */
type OpeningTrack = { from: number; at: number; found: string };

/**
 * One static's step of the reading above, after `scanTag` has read static `j` into `state`: the tag hole `j` is judged
 * by. `openingTags` takes it over a fresh scan; `compile` takes it in its OWN scan of the statics (2026-11-20), which
 * reads them from the same start in the same order, so a template with a script hole is no longer scanned twice — the
 * second scan was a third of what 0.3.2's compile cost over 0.3.0's.
 */
const openingStep = (strings: readonly string[], j: number, state: ScanResult, track: OpeningTrack): string => {
  const text = strings[j]!;
  if (state.rawTag === 'script' && state.rawFrom !== -1) {
    const end = state.rawFrom;
    const from = state.tagAt >= 0 ? j : track.from;
    const at = state.tagAt >= 0 ? state.tagAt : track.at;
    track.found = from === j ? text.slice(at, end) : strings[from]!.slice(at) + '\uFFFF' + strings.slice(from + 1, j).map((t) => `${t}\uFFFF`).join('') + text.slice(0, end);
  }
  if (state.inTag && state.tagAt >= 0) {
    track.from = j;
    track.at = state.tagAt;
  }
  return track.found;
};

/**
 * **The start tag that OPENED each hole's script, as written** (a hole inside the tag as `\uFFFF`), read by THIS
 * tokenizer, never searched for — one entry per hole, dense: for hole `h`, the tag of the LAST static up to `h` that
 * opens a script still open at its end (`''` for none). That static's `>` is where its last raw content began
 * (`rawFrom`), and the tag began in that static (`tagAt`: nothing after the `>` is a tag, so the last tag begun there is
 * the script's) or in the earlier static it was left open in (`open`). ONE scan of the statics gives every hole's tag;
 * the function it replaced scanned from the template's start once per script hole, twice per static (2026-11-19). Cold:
 * `compile` asks it once per template, and only when a hole is in a script. Exported for its differential test only.
 *
 * The last script, never the first (2026-11-19): a static that closed one script and opened another
 * (`</script><script>`) kept the earlier script's tag, and a prefix search found a static's FIRST script, so a hole in a
 * code script after a JSON data block was judged by the data block's tag and served.
 */
export const openingTags = (strings: readonly string[], depth: number): string[] => {
  const tags: string[] = [];
  const track: OpeningTrack = { from: 0, at: 0, found: '' };
  let state: ScanStart | ScanResult = freshScan(depth);
  for (let j = 0; j < strings.length - 1; j++) {
    state = scanTag(strings[j]!, state);
    tags.push(openingStep(strings, j, state, track));
  }
  return tags;
};

/**
 * **`compile`'s rare paths live out of line.** V8 compiles a function whole on its first call, and `compile` runs on
 * every page's first render, so a branch a valid template never takes — an error built in place, a forgery's warning,
 * a raw-text slot's closing — is paid for by every render that never reaches it: the first render's cost followed
 * `compile`'s bytecode size (fresh-process A/B with and without `--no-lazy`, 2026-11-21).
 *
 * This one is a misuse's error, its prose its `PROSE` entry unless given (a client twin's).
 */
const refusal = (code: string, prose: Said = PROSE[code]!()): Error => own(new Error(ssrMisuse(code, prose)));
/** Once per process per component (Brian, 2026-10-09); the forgery itself still renders as the object it is. */
const forgedTemplate = (): null => {
  const tag = currentRenderingTag();
  if (once('forged-template', tag)) console.warn(ssrWarning((tag ? `<${tag}>` : 'the page'), 'forged-template', TWINS.forgedTemplate()));
  return null;
};
/**
 * **The author's static text of a JSON block or an HTML `<style>` is written closed too** (2026-11-18), so the
 * served text is the COMPOSED text closed (`closedRawText`), byte for byte what a client writes: in a block every
 * `<` as `\u003c` (a static `<` before a value, `"<${'/script>…'}"`, otherwise closed it early; in valid JSON a `<` is
 * only ever inside a string, so it is lossless), in a style each `</style` as `<\/style` (a static `</stylex` ends
 * nothing, and is written so all the same). A closer formed ACROSS a style hole is `styleHole`'s, per render. The
 * content in the static before this hole (from where its raw text began, or all of it inside the element) and in the
 * static after (up to its end tag). Raw text follows the tag edits, so it is the same text in the part. Idempotent,
 * so a static between two holes of one element may be visited twice.
 */
const closeRawSlot = (parts: string[], strings: TemplateStringsArray, from: number, i: number, json: boolean): void => {
  const until = closerAt(strings[i + 1]!, 0, json ? 'script' : 'style');
  const before = parts[i]!;
  const cut = from === -1 ? 0 : before.length - (strings[i]!.length - from);
  /** Text with no `<` is its own closed form (`closedRawText` changes only a `<`), so it is left as it is. */
  if (before.indexOf('<', cut) !== -1) parts[i] = before.slice(0, cut) + closedRawText(before.slice(cut), json);
  const after = parts[i + 1]!;
  const stop = until === -1 ? after.length : until;
  const lt = after.indexOf('<');
  if (lt !== -1 && lt < stop) parts[i + 1] = closedRawText(after.slice(0, stop), json) + after.slice(stop);
};
const compile = (strings: unknown, depth: number): Plan | null => {
  /**
   * **A template is a tagged template literal's, never data shaped like one.** Template detection is by shape (`strings`),
   * so `JSON.parse('{"strings":["<img src=x onerror=…>"]}')` — a request body, an API field an attacker can make an
   * object — was rendered as MARKUP wherever it was interpolated. A literal's strings array owns a `raw` property, which
   * JSON cannot give an array (and an object that owns one is not an array): the check Lit makes, here on the plan
   * cache's miss, which a forged array always is — so it costs a cached template nothing. A forgery is answered with
   * `null` — the caller renders it as the ordinary object it is — and never a throw: the value is attacker-controlled
   * by definition, and a throw would trade the injection for the whole response.
   */
  if (!isLiteral(strings)) return forgedTemplate();
  const parts: string[] = [];
  const kinds: Kind[] = [];
  const names: string[] = [];
  /**
   * Whether a slot has to scan the open tag for an earlier write of its own name, and the tag it
   * sits in.
   *
   * Both are properties of the *template*, not of a render: an attribute can only be duplicated by
   * the statics around it, by an earlier binding in the same tag, or by a spread — and every one of
   * those is visible here. Computing them per render cost 0.03–0.06 µs on every attribute, boolean
   * and form-property binding, which is 18–68% of what those bindings cost in total. Almost no tag
   * writes a name twice, so almost every one of those scans found nothing.
   */
  const strip: boolean[] = [];
  const owners: string[] = [];
  /** Which RAWTEXT element each binding sits inside, `''` when none. See `RAWTEXT`. */
  const raws: string[] = [];
  /**
   * Per static, where raw content last began in it (`rawFrom`) — read only for a JSON block or an HTML style, below,
   * which asks `closerAt` where that content ends in the static after.
   */
  const rawFroms: number[] = [];
  /** Per hole, the start tag its script was opened by (`openingStep`), read in this function's own scan. */
  const openings: string[] = [];
  const opening: OpeningTrack = { from: 0, at: 0, found: '' };
  /** Per child binding (sparse): the foreign-content depth it sits at, which a template rendered there starts from. */
  const depths: Array<number | undefined> = [];
  /** Per child binding (sparse): whether it sits in a text-only element, where a template is refused (see `serializeValue`). */
  const texts: Array<boolean | undefined> = [];
  /**
   * Whether each slot is an **element position** — inside a tag but not inside an attribute value.
   *
   * `<b title="${x}">` is also a value inside a tag, and it is *not* an element position: the
   * statics carry `title="` and `">` around it and the value is simply written between them. The
   * difference is what the static ends with, so it is settled here rather than guessed at render.
   */
  const elementPositions: boolean[] = [];
  /**
   * Which ELEMENT each slot belongs to — an ordinal that advances when a tag opens. The owner tag
   * NAME cannot tell two sibling `<x-row .item=${…}>`s apart, and component-prop delivery needs
   * to: every slot sharing an ordinal delivers to one instance, per application.
   */
  const elements: number[] = [];
  let elementOrdinal = 0;
  /** Names written so far in the tag being built — statics and earlier bindings alike. */
  let written = new Set<string>();
  /** A spread's keys are runtime values, so a tag holding one can never be settled here. */
  let dynamicTag = false;
  let owner = '';

  /**
   * The quote a sigil or event binding's value opened with (`''` unquoted), while that value is still open: the rest of
   * it comes off the front of the next static, and a hole before it ends is dropped with it. `undefined` otherwise.
   */
  let openQuote: string | undefined;
  /** The open sigil value's first hole (-1 for none, or a dropped binding, which has no value) and its statics so far. */
  let joinAt = -1;
  let pieces: string[] | undefined;
  let joins: Array<readonly string[] | undefined> | undefined;
  let wasInTag = false;
  /** Carried across statics — see `scanTag`. */
  let tagState: ScanStart | ScanResult = freshScan(depth);
  /** Per binding: whether a component property's name is a URL sink. */
  const urls: Array<boolean | undefined> = [];
  /**
   * Per attribute-value binding, by binding index (sparse): its attribute's group (shared by every hole in one value), the static
   * written before the value — ready for double quotes — and that static decoded, for the URL check.
   */
  const groups: Array<Group | undefined> = [];
  const leads: string[] = [];
  const decodedLeads: string[] = [];

  for (let i = 0; i < strings.length - 1; i++) {
    let part = strings[i];
    /** Whether this hole is inside a sigil or event binding's value, after its first hole — dropped below. */
    let continued = false;
    if (openQuote !== undefined) {
      const end = valueEnd(part, openQuote);
      if (end === -1) {
        if (joinAt !== -1) pieces = morePieces(pieces, part);
        part = '';
        continued = true;
      } else {
        if (joinAt !== -1) joins = closeJoin(joins, kinds, joinAt, pieces, part, end, openQuote);
        joinAt = -1;
        part = afterValue(part, end, openQuote);
        openQuote = undefined;
      }
    }
    /**
     * Scanned from the **author's** static, not the trimmed one.
     *
     * `part` has already had a binding's opening quote removed by the `openQuote` handling above, so
     * `?hidden='${x}'` reaches the scanner as `?hidden=` followed by `>bs</b>` — the closing quote
     * gone. The scanner then waits for a `'` that never comes and reads the whole rest of the
     * template as one attribute value, which made every element position after it invisible.
     */
    /**
     * Whether this static ends with such a start tag. The cheap part is written out here, no call: on a cold server a
     * newly compiled function costs its first render more than the check does (measured 2026-10-07). Only a static
     * ending in `>` that continues such a tag, or holds `<pre`, `<lis` or `<tex` in any case, is asked properly —
     * three letters, because one let `<p>`, `<li>`, `<td>` and `<title>` through and every template paid the scan.
     */
    let taker = false;
    const text = strings[i];
    if (text.charCodeAt(text.length - 1) === 62) {
      const open = tagState.inTag ? tagState.tagName : '';
      let maybe = open === 'pre' || open === 'listing' || open === 'textarea';
      for (let at = text.indexOf('<'); !maybe && at !== -1; at = text.indexOf('<', at + 1)) {
        const a = text.charCodeAt(at + 1);
        const b = text.charCodeAt(at + 2);
        const c = text.charCodeAt(at + 3);
        /** `pre`, `lis` or `tex`, each letter in either case. */
        maybe =
          ((a === 112 || a === 80) && (b === 114 || b === 82) && (c === 101 || c === 69)) ||
          ((a === 108 || a === 76) && (b === 105 || b === 73) && (c === 115 || c === 83)) ||
          ((a === 116 || a === 84) && (b === 101 || b === 69) && (c === 120 || c === 88));
      }
      if (maybe) taker = takesNewline(text, tagState);
    }
    tagState = scanTag(strings[i], tagState);
    rawFroms[i] = tagState.rawFrom;
    openings.push(openingStep(strings, i, tagState, opening));
    /** A `<textarea>` open at a foreign depth is one a select holds, read as HTML by both parsers (see `scanTag`): its line feed is taken. */
    if (taker && ((tagState.foreign !== 0 && tagState.textTag !== 'textarea') || tagState.inert !== 0)) taker = false;
    /**
     * A hole in the content of an SVG `<script>` (or a MathML element of that name) is code too: refused as an HTML
     * script's is (`ssr-script-hole`, every build), JSON or not — a foreign script is no data block (2026-11-18).
     * Inside a tag there too (2026-11-21): whether the script's content holds a tag at all depends on a namespace the
     * scan may not know (in a select, or a template rendered inside `<svg>`), so a hole the scan places in an attribute
     * of `<script>x=a<b c=${v}>` can sit in the source the browser runs.
     */
    if (hasOpen(tagState.opens, 'script'))
      throw refusal('ssr-script-hole');
    /**
     * **Every question about where this hole sits is answered by that scan** — whether it is inside a tag, which tag,
     * whether a new one opened, and whether the hole is a sigil binding. They used to be answered beside it, by tests
     * on the static's tail (its last `<` against its last `>`, a sigil pattern, a tag-name pattern), which knew nothing
     * of comments, raw text or the tokenizer's names: `<!-- <div .innerHTML=${v}> -->` honored the binding INSIDE the
     * comment, so a `-->` in `v` ended it, and `<textarea><b .innerHTML=${v}>` broke out of the textarea the same way.
     */
    const inTag = tagState.inTag;
    /** `<template>`'s content: inert markup the client never walks, so it never reaches this
     * binding — it neither renders the value nor keeps the attribute holding it. Nor does this.
     */
    const inert = tagState.inert > 0;
    /** A new tag starts wherever this text opens one that is still open at its end; what the previous tag held is irrelevant. */
    const opensTag = inTag && tagState.tagAt !== -1;
    if (opensTag || (!inTag && wasInTag)) {
      written = new Set<string>();
      dynamicTag = false;
      if (opensTag) elementOrdinal++;
    }
    wasInTag = inTag;
    /** The tag a binding belongs to, by the name the tokenizer reads — the element's `localName` on the client. */
    owner = inTag && !tagState.closing ? tagState.tagName : '';
    /**
     * Whether this hole is the FIRST in an attribute's value — `name=${…}` or `name="x${…}`, quoted or not, with space
     * around `=` as the tokenizer allows. Only then can it be a sigil or event binding, as the client reads one: by
     * the attribute's name, whatever statics its value holds. A hole later in a value (`title="a .x=${…}"`) is part
     * of that value, whose name is `title`.
     */
    const first = inTag && tagState.inValue && tagState.opened;
    /** Offsets are in the author's static; `part` may have lost a leading quote to the binding before it. */
    const shift = strings[i].length - part.length;
    /**
     * Names in the statics are recorded from the text that is actually **emitted**, which is the
     * part with this binding's own name already trimmed off. Scanning the raw part instead counts
     * `title=` — the binding's own name — as a prior write, and in `<b title="a" title=${x}>` the
     * two collapse into one entry, so the real duplicate goes unnoticed.
     */
    const record = (staticText: string): void => {
      if (inTag) for (const [, found] of staticText.matchAll(STATIC_ATTRIBUTE)) written.add(asciiLower(found));
    };

    /**
     * **A further hole in a sigil or event binding's value** (`@click="${fn} ${x}"`, `?hidden=${a}${b}`): the client
     * drops it with the attribute, so this writes nothing for it, whatever it holds. Fail closed: before this, such a
     * hole reached the attribute path with the binding's quote stripped, and a value in it wrote attributes of its own.
     */
    if (continued) {
      parts.push('');
      kinds.push(DROPPED);
      names.push('');
      strip.push(false);
      owners.push(owner);
      raws.push(tagState.rawTag);
      elementPositions.push(false);
      elements.push(elementOrdinal);
      continue;
    }

    /**
     * **A sigil binding** — `.prop`, `?bool`, `@event`, `&ref`, `!live` — is an attribute whose name starts with the
     * sigil and whose whole value is this hole, however it is quoted. The name after the sigil is any name character,
     * as the client's scanner reads it: `._private` and `@_tap` are sigil bindings, and a sigil INSIDE a name is part
     * of it (`data-x.y` is an attribute). A sigil the server does not know is not inert — it would fall through to the
     * attribute path and emit an attribute named `!` — so every sigil is added here in the same pass it is added to
     * the renderer.
     */
    if (first && isSigil(tagState.attrRaw.charCodeAt(0))) {
      /** The space that preceded the binding goes with it, so dropped bindings leave no residue. */
      const before = part.slice(0, nameCut(strings[i], tagState.nameAt) - shift).replace(/ $/, '');
      record(before);
      parts.push(before);
      openQuote = tagState.quote;
      const kind = tagState.attrRaw[0];
      /**
       * Absent after a bare `&=`, which is an element ref with no name — legal: the renderer back-reads the name `&`
       * and maps it to a ref, so the client renders nothing, and so does this. A nameless `.=`, `?=`, `@=` or `!=` has
       * no meaning either, and is dropped the same way.
       */
      const sigilName = tagState.attrRaw.slice(1);
      if (inert) {
        kinds.push(DROPPED);
      } else if (kind === '?') {
        kinds.push(BOOLEAN);
      } else if ((kind === '.' || kind === '!') && sigilName && owner.includes('-')) {
        /**
         * A property on a COMPONENT tag is neither markup nor a client concern: it is the data the
         * child renders from, so it is delivered to the instance the nested-component scan will
         * render — before `FORM_ATTRIBUTES`, because `.value` on `<my-input>` is that component's
         * prop, not a form control's dirty value. `!name` is here beside `.name` for the same
         * reason it serializes as `.name` on form controls, and because a spread reports `!` keys
         * as properties — the two spellings of one binding must get one answer. Whether the tag is
         * actually registered is a render-time question (the registry fills as modules execute),
         * answered in the case below.
         */
        kinds.push(COMPONENT_PROP);
        urls[kinds.length - 1] = URL_SINK.test(sigilName);
      } else if (kind === '.' && CONTENT_PROPS.has(sigilName)) {
        /**
         * `.innerHTML`/`.textContent` on a plain element is the trusted-markup door (`@verajs/renderer`'s property
         * binding): the value is the element's content, written after the open tag. Its foreign depth is the host's
         * INSIDE — the tag's depth, plus one when the host is itself `<svg>`/`<math>`/`<select>` — so a `<style>` in it
         * is read the way the browser will read it. A custom-element host took the `COMPONENT_PROP` branch above.
         */
        kinds.push(CONTENT);
        depths[kinds.length - 1] =
          owner === 'svg' || owner === 'math' ? positionOf(tagState.foreign + 1, owner) : owner === 'select' ? positionOf(tagState.foreign + 1, '') : tagState.foreign === 0 ? 0 : positionAt(tagState.foreign, tagState.opens);
      } else if ((kind === '.' || kind === '!') && isFormProperty(owner, sigilName)) {
        /**
         * `!name` is a **live** property, and still a property: the sigil only changes when the client re-writes it,
         * and a server has nothing to re-write against — so it serializes exactly as `.name` does, and the first
         * paint is right before the client takes over.
         */
        kinds.push(FORM_PROP);
      } else {
        kinds.push(DROPPED);
      }
      /** `@` and `&` ignore their statics on the client, and every DROPPED binding writes nothing: no value to join. */
      joinAt = kinds.length - 1;
      if (kinds[joinAt] === DROPPED) joinAt = -1;
      pieces = tagState.valueStart === strings[i].length ? undefined : leadPieces(strings[i], tagState.valueStart);
      names.push(sigilName);
      strip.push(dynamicTag || written.has(asciiLower(sigilName)));
      owners.push(owner);
      raws.push(tagState.rawTag);
      elementPositions.push(false);
      elements.push(elementOrdinal);
      if (sigilName) written.add(asciiLower(sigilName));
      continue;
    }

    openQuote = undefined;

    /** `onClick=${fn}` — the React-shaped event binding, named as the client names it: a client concern, dropped like `@`. */
    if (first && isEventName(tagState.attrRaw)) {
      const before = part.slice(0, tagState.nameAt - shift).replace(/ $/, '');
      record(before);
      parts.push(before);
      openQuote = tagState.quote;
      kinds.push(DROPPED);
      names.push('');
      strip.push(false);
      owners.push(owner);
      raws.push(tagState.rawTag);
      elementPositions.push(false);
      elements.push(elementOrdinal);
      continue;
    }

    /**
     * **A bound attribute value, in any position** — double-quoted, single-quoted or unquoted, with space
     * around `=`, with statics beside it, or several holes in one value.
     *
     * The client never lets the tokenizer see a value: it joins the attribute's statics and values and calls
     * `setAttribute`. This streamed each position differently instead — a lone unquoted `title=${x}` was
     * quoted, a quoted value was escaped between the author's quotes, and every other shape went out raw
     * and UNQUOTED: `title=pre${x}`, `title=${a}${b}` and `title = ${x}` let a value carrying
     * ` onmouseover=…` end the attribute and start a live handler, while the client rendered one harmless
     * `title`. So every hole in one value shares ONE group, compiled here from `scanTag`'s state: the
     * attribute's head (name, `=`, opening quote, static prefix) and tail (static suffix, closing quote)
     * come off the statics, and the render writes the whole attribute once, always double-quoted — or not
     * at all. Position stops mattering because nothing a value holds can reach the tokenizer.
     */
    if (tagState.inTag && tagState.inValue && (tagState.opened || groups[kinds.length - 1]?.serial === tagState.serial)) {
      const previous = groups[kinds.length - 1];
      let group: Group;
      if (previous !== undefined && previous.serial === tagState.serial) {
        group = previous;
        group.sole = false;
        parts.push('');
        leads[kinds.length] = forDoubleQuotes(part, group.quote);
        decodedLeads[kinds.length] = decodeSchemeReferences(part);
      } else {
        const before = part.slice(0, tagState.attrStart - shift);
        const prefix = part.slice(tagState.valueStart - shift);
        const lower = tagState.attrName;
        /** Whether the name is a URL sink, and which kind (captured: from the start; not: item by item). */
        const sink = URL_SINK.exec(lower);
        record(before);
        parts.push(before);
        group = {
          name: tagState.attrRaw,
          /** Everything the render writes before the value: the separating space, the name, `=` and the quote. */
          open: ` ${tagState.attrRaw}="`,
          serial: tagState.serial,
          quote: tagState.quote,
          first: kinds.length,
          last: kinds.length,
          /**
           * Never served (1): inert content, a bound `srcdoc` (it renders its value as a document) and a bound inline
           * handler (`onclick=${…}` runs its value as code). A URL sink refuses `javascript:` (2), and an animation's
           * value refuses it in any `;`-separated item (3) — as the client does. Above 1: the joined value is checked.
           */
          refuse: inert || lower === 'srcdoc' || INLINE_HANDLER.test(lower) ? 1 : sink === null ? 0 : sink[1] ? 2 : 3,
          /** An earlier write of this name in the tag: the client's `setAttribute` replaces it, so it is removed. */
          strip: dynamicTag || written.has(lower),
          /** The WHOLE value is this one binding — the only shape where a nullish value removes the attribute. */
          sole: prefix === '',
          suffix: '',
          decodedSuffix: '',
        };
        written.add(lower);
        leads[kinds.length] = forDoubleQuotes(prefix, group.quote);
        decodedLeads[kinds.length] = decodeSchemeReferences(prefix);
      }
      group.last = kinds.length;
      groups[kinds.length] = group;
      kinds.push(ATTRIBUTE);
      names.push(group.name);
      strip.push(false);
      owners.push(owner);
      raws.push(tagState.rawTag);
      elementPositions.push(false);
      elements.push(elementOrdinal);
      continue;
    }
    record(part);
    /**
     * A binding dropped inside a comment leaves ONE space where it was, so the statics on either side cannot meet as
     * a different token: `<!${…}--!>` read as a bogus comment, ended by its `>`, while the bare join `<!--!>` OPENS a
     * comment that swallowed the page after it; `-${…}->` joined to `-->` and ended a comment early.
     */
    parts.push(tagState.comment !== '' && !inert ? part + ' ' : taker ? part + '\n' : part);
    /** Its position: the depth and the namespace there, so a template rendered into it starts where it is (see `positionOf`). */
    const position = positionAt(tagState.foreign, tagState.opens);
    if (position !== 0) depths[kinds.length] = position;
    /**
     * Inside `<noscript>` too, at any depth (2026-11-18): the client reads a noscript's content as raw text (Firefox, and
     * the renderer's scanner everywhere) and writes its values as encoded text, so a template there cannot be placed —
     * refused here as in a text-only element (`ssr-template-in-text`), one rule on both sides. Values stay escaped, and
     * an attribute value stays quoted.
     */
    if (tagState.textTag || hasOpen(tagState.opens, 'noscript')) texts[kinds.length] = true;
    /** A binding inside a comment is dropped, as the client drops it — never written into the comment. */
    kinds.push(inert || tagState.comment ? DROPPED : TEXT);
    names.push('');
    strip.push(false);
    owners.push(owner);
    raws.push(tagState.rawTag);
    /** Inside a tag, and not inside an attribute value: `<input ${ref} />`, `<b ${spread(…)}>`. */
    const elementPosition = tagState.inTag && !tagState.inValue;
    /**
     * A TAG-name hole — right after `<` or `</`, or inside a tag name: refused in every build, the twin of the client's
     * development refusal, one message.
     */
    const tagNameHole = tagState.phase === TAG_OPEN || tagState.phase === END_TAG_OPEN || tagState.phase === TAG_NAME;
    if (tagNameHole)
      throw refusal('tag-hole', TWINS.tagHole());
    if (elementPosition && !tagNameHole && (NAME_CHAR_BEFORE.test(part) || NAME_CHAR_AFTER.test(strings[i + 1])))
      nameHole(part, strings[i + 1]);
    elementPositions.push(elementPosition);
    elements.push(elementOrdinal);
    /** A spread's keys are unknown until it runs, so its tag can no longer be settled here. */
    if (elementPosition) dynamicTag = true;
  }

  let last = strings[strings.length - 1];
  if (openQuote !== undefined) {
    const end = valueEnd(last, openQuote);
    if (joinAt !== -1) joins = closeJoin(joins, kinds, joinAt, pieces, last, end, openQuote);
    last = end === -1 ? '' : afterValue(last, end, openQuote);
  }
  parts.push(last);

  /** Each attribute's tail — its static suffix and closing quote — comes off the static after its last hole. */
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (group === undefined || group.last !== i) continue;
    const next = parts[i + 1];
    /**
     * An unquoted value ends at the tokenizer's whitespace (never `\s`: a `\v` is value text, and cutting there left
     * the rest to open a quote that never closed, losing the element) or `>` — and at a `/>` RIGHT after its last hole, which is the tag's
     * self-close, not value text: the client's scanner keeps the slash out of the value the same way (`<circle
     * r=${r}/>`). Taken as text, it served `r="5/"` and left the element open, nesting the next one inside it.
     */
    let end = group.quote ? next.indexOf(group.quote) : next.startsWith('/>') ? 0 : next.search(/[\t\n\f\r >]/);
    /** A template that ends inside the value: the rest is the suffix, as the client's parser reads it. */
    const closed = end !== -1;
    if (!closed) end = next.length;
    const suffix = next.slice(0, end);
    if (suffix !== '') group.sole = false;
    group.suffix = forDoubleQuotes(suffix, group.quote);
    group.decodedSuffix = decodeSchemeReferences(suffix);
    parts[i + 1] = next.slice(closed && group.quote ? end + 1 : end);
  }

  /**
   * **A template ends where it began.** The client parses every template on its own, so whatever one leaves open — a
   * comment, a `<style>`, a `<textarea>`, an `<svg>` — the parser closes at its end. The server concatenates, and
   * left open, that state swallowed the PARENT's markup: `${html`<svg>`}<style>${x}</style>` wrote `x` raw inside what
   * the browser parses as SVG, and `${html`<!--`}` let a `-->` in a later raw value end the comment. So the end closes
   * what this template opened, innermost first — the client's own end-of-input rule, read off the statics once. A
   * template that ends INSIDE a tag is refused, in every build: the client's parser drops an unfinished tag whole,
   * which no closer can reproduce, and left open it swallowed the parent's next markup into its attributes. A bare `<`
   * that never started a tag name, as in `a < b`, is text. The client refuses the same templates in development.
   */
  const end = scanTag(strings[strings.length - 1], tagState);
  rawFroms[strings.length - 1] = end.rawFrom;
  if (end.inValue || (end.inTag && end.tagName))
    throw refusal('ssr-unfinished-tag');
  /** A `<plaintext>` has no closer: served, everything after it on the page parsed as its text. */
  if (end.textTag === 'plaintext') throw refusal('ssr-plaintext');
  const closers = closersOf(end);
  if (closers) parts[parts.length - 1] += closers;

  /**
   * A value in a `<script>` is code — on a served page it runs — so a script hole is refused (`ssr-script-hole`, every
   * build) unless the script is a JSON data block, judged on the start tag that OPENED it (`openingStep`, in the scan above: this tokenizer's
   * own reading, never a search back, so a `<script…>` inside a script's text or a quoted value is never taken for it).
   * A data block's values are written with `<` as `\u003c` (`escapeRawText`'s `json`). Once per template, here.
   */
  for (let i = 0; i < raws.length; i++) {
    if (raws[i] === 'script') {
      /**
       * A start tag holding a hole is no data block either (2026-11-18): a binding there — `?type=${false}`, a spread,
       * `.type` — changes the type after it was judged, and the script is then served (or saved) as code.
       */
      const tag = openings[i]!;
      if (!(writtenDataBlock(tag) ?? dataBlock(tag)) || tag.includes('\uFFFF')) throw refusal('ssr-script-hole');
      raws[i] = 'json';
    }
    if (raws[i] === 'json' || raws[i] === 'style') closeRawSlot(parts, strings, rawFroms[i]!, i, raws[i] === 'json');
  }

  /**
   * **When a style value cannot take part in a closer formed across its hole** — read off the final statics, once
   * (2026-11-19). `styleHole` neutralizes a `</style` that overlaps the value in the window of the 6 characters written
   * before it, the value and the next static's first 6; it starts with its `</`, so with `p` the window position of its
   * `<`, an overlapping one has `p` in [start − 6, stop − 1] (start/stop: where the value begins and ends). `styleHole`
   * reads those 6 characters from the static before the hole whenever it has 6, and from `out` only when it is shorter.
   * So when that static has 6 or more characters and no `<` in its last 6, `p` ≥ start, and a crossing closer needs its
   * `</` at (p, p + 1) inside the value, or the value ending in `<` (p = stop − 1) with the next static starting with
   * `/`. 1: the static is such; 2: and the next static starts with `/`; 0: neither (or no style hole). Dense, so the
   * render reads a number at every slot.
   */
  const styleTails: number[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const before = parts[i]!;
    styleTails.push(raws[i] !== 'style' || before.length < 6 || before.lastIndexOf('<') >= before.length - 6 ? 0 : parts[i + 1]!.charCodeAt(0) === 47 ? 2 : 1);
  }
  /**
   * Dense, so the render loop reads a value at every binding: both are filled sparsely above, and a hole read falls
   * through to the prototype chain on every child binding of every render — measured at about 3% of a server render.
   * Built in a loop, not `Array.from` with a callback, which cost compile about a fifth of its time (2026-11-20).
   */
  const denseDepths: number[] = [];
  const denseTexts: boolean[] = [];
  for (let i = 0; i < kinds.length; i++) {
    denseDepths.push(depths[i] ?? 0);
    denseTexts.push(texts[i] === true);
  }
  const plan: Plan = {
    parts, kinds, names, strip, owners, raws,
    depths: denseDepths,
    texts: denseTexts,
    elementPositions, elements, groups, leads, decodedLeads, urls, joins, styleTails,
  };
  if (depth === 0) plans.set(strings, plan);
  else {
    let byDepth = foreignPlans.get(strings);
    if (byDepth === undefined) foreignPlans.set(strings, (byDepth = new Map()));
    byDepth.set(depth, plan);
  }
  return plan;
};

/**
 * `depth` is the position the template renders into (see `positionOf`): its foreign-content depth — 0 at the top and
 * in HTML — and, past depth 0, the namespace there; a bare depth reads as an unknown namespace.
 *
 * **Where a template renders decides how its raw text parses, and the template cannot see it.** The browser parses
 * the ONE string this produces, so `html`<svg>${child}</svg>`` puts `child`'s `<style>` inside SVG, where its
 * content is markup, however `child` was written; and an `svg`/`mathml` template is foreign content wherever it
 * goes, because the client parses it inside an `<svg>`/`<math>` wrapper. Scanning each template as though it began
 * in HTML wrote both as raw text — unescaped — and the browser then parsed a value's `<img onerror>` as an element.
 * So a template starts at its position's depth, and at least 1 if it is foreign itself. Erring deep is the safe
 * direction: an `svg` template rendered outside any `<svg>` is HTML to the browser, and its `<style>` then shows
 * the escapes as text — a visible mismatch, never an injection.
 */
export const serializeTemplate = (template: SsrTemplate, depth = 0): string => {
  const { strings, values } = template;
  /**
   * `_$litType$` is absent on core's `html`, and `undefined > 1` is false — the answer wanted; the `!` only lets the
   * comparison be written. A bare depth: the namespace stays unknown (see `positionOf`). The client parses an `svg`/`mathml` template inside a
   * wrapper, but its server output may be spliced anywhere, and outside an `<svg>` it is HTML: read as SVG, its
   * `<title>` became an integration point and a `<style>` in it raw text, which standalone HTML ends at `</title>`
   * (the raw-text table's `svgTemplate × <title>` row injected).
   */
  if (template['_$litType$']! > 1 && depthOf(depth) === 0) depth = 1;
  /**
   * `strings` is any value here, a forgery's included: the cast only names the key the maps hold, and `WeakMap#get`
   * answers `undefined` for a key it could never hold, which sends a forgery on to `compile`'s refusal.
   */
  const { parts, kinds, names, strip, owners, raws, depths, texts, elementPositions, elements, groups, leads, decodedLeads, urls, joins, styleTails } =
    (depth === 0 ? plans.get(strings as TemplateStringsArray) : foreignPlans.get(strings as TemplateStringsArray)?.get(depth)) ??
    compile(strings, depth) ??
    FORGED;
  /**
   * Not a template — data shaped like one (see `compile`): the text a plain object renders as, the client's very
   * constant. Never the forgery's own conversion: JSON can supply a `"toString"` key, and converting through it throws.
   */
  if (parts === undefined) return FORGED_TEXT;
  /** The attribute being built: its escaped value so far, and the value the client would join (for the URL check). */
  let attribute = '';
  let joined = '';
  let out = '';
  /**
   * The instances this application is delivering properties to, allocated on the FIRST
   * component-prop slot — `serializeTemplate` is the hot path the public SSR numbers rest on, and
   * a template with no component props (almost all of them) must pay one `null` local and nothing
   * else. `instances` is keyed by element ordinal, so `<x-row .a=${…} .b=${…}>` builds ONE
   * instance for both keys while a list's N applications build N; `mark` is the marker text for a
   * just-built instance, held rather than appended directly because the spread path folds `out`
   * while delivering — each delivering case flushes it into the open tag it is building.
   */
  let adoption: Adoption | null = null;
  /**
   * Content that belongs *after* the tag being built rather than inside it — a `<textarea>`'s
   * value, which is text and not an attribute. Written into the next static right after the `>`
   * that closes the tag, replacing whatever the author wrote there, exactly as assigning `.value`
   * does on the client.
   */
  let pendingText: string | null = null;
  /** The close tag `insertContent` strips to when flushing `pendingText` — the host whose content it is (`textarea` for a form value). */
  let pendingStrip = 'textarea';
  /**
   * What each `<select>`'s `.value` or `.selectedIndex` asks for, resolved into `<option selected>` after the loop —
   * the options are usually a nested template, so nothing can be decided until the string is whole.
   */
  const selectValues: Array<string | number> = [];

  for (let i = 0; i < kinds.length; i++) {
    const part = parts[i];
    if (pendingText === null) out += part;
    else {
      out += insertContent(part, pendingText, pendingStrip);
      pendingText = null;
    }
    let kind = kinds[i]!;
    let value = values[i];
    /** A `?`, `.` or `!` value with statics or several holes is its joined text, then its binding — see `closeJoin`. */
    if (kind > JOINED) {
      kind = (kind - JOINED) as SlotKind;
      value = joinValue(joins![i]!, values, i);
    }
    switch (kind) {
      case TEXT:
        /** A spread rewrites the open tag it sits in, so it is folded rather than appended. */
        if (value !== null && typeof value === 'object' && typeof (value as Probed)._$attrs$ === 'function') {
          /**
           * A spread's property keys deliver exactly as the written form above does — `props()`
           * IS a spread, so this is the surface the headline API arrives through. Lazily: the
           * receiving instance is built on the spread's first property key, so a spread of plain
           * attributes on a component never builds one.
           */
          const componentTag = owners[i].includes('-') && registry.has(owners[i]) ? owners[i] : '';
          const folded = foldSpread(
            out,
            owners[i],
            (value as Spread)._$attrs$(),
            componentTag === ''
              ? undefined
              : (name, propValue) => {
                  adoption ??= { instances: new Map(), mark: '' };
                  deliverProperty(claimInstance(adoption, elements[i], componentTag), componentTag, name, propValue);
                }
          );
          out = folded.out;
          if (adoption !== null && adoption.mark !== '') {
            out += adoption.mark;
            adoption.mark = '';
          }
          /** With its own host: a stale `pendingStrip` from an earlier `.textContent` kept the author's content. */
          if (folded.text !== null) {
            pendingText = folded.text;
            pendingStrip = owners[i];
          }
          if (folded.select !== null) out += ` ${SELECT_MARK}="${selectValues.push(folded.select) - 1}"`;
        }
        /**
         * An **element-position** expression that is not a spread is a ref — `<input ${myRef} />`,
         * where the renderer hands the element to a function or assigns it to `.value`. It is
         * client state, like `@event`, and has no markup.
         *
         * It used to be stringified into the open tag, so `<input ${ref(null)} />` served
         * `<input [object Object]>` — which the parser then read as two attributes named
         * `[object` and `object]`. A value in this position never has markup; only a spread does.
         */
        else if (elementPositions[i]) {
          /**
           * The space that introduced the binding goes with it, exactly as a dropped sigil binding's
           * does. Leaving it served `<p >r</p>` where the client renders `<p>r</p>` — harmless to a
           * parser, and still a difference between the two halves for something neither of them
           * renders at all.
           */
          out = out.replace(/ $/, '');
          break;
        }
        /**
         * **Raw text is written raw, and its own end tag is neutralized.**
         *
         * A browser does not decode a character reference inside `<style>` or `<script>`, so
         * escaping there protects nothing and corrupts the content: `<style>${'.a > .b'}</style>`
         * served `.a &#62; .b`, a selector that matches nothing, while the client — which sets text
         * through the DOM and never re-parses — rendered `.a > .b`. Every interpolated stylesheet
         * was broken server-side and correct client-side, which is also a hydration divergence.
         *
         * Not escaping means the element's end tag has to be taken out of the value instead, or it
         * closes the element and everything after it parses as markup. `<\/style` is valid CSS and
         * `<\/script` is the canonical form in JavaScript; both render identically and neither is
         * seen by the tokenizer.
         *
         * `<title>` and `<textarea>` are RCDATA, not RAWTEXT — references *are* decoded there — so
         * they keep ordinary escaping, which is what the client produces for them too.
         */
        else if (raws[i] === 'style') {
          /**
           * **The value written as it is, when nothing can cross its hole** (`styleTails`, `compile`): no `</` in it,
           * and it does not end in `<` before a static starting with `/`. Then `escapeRawText` has nothing to replace
           * (its pattern starts `</`), and `styleHole` finds no closer (the `<` of any overlapping one would be in the
           * value) and answers `out + value` — so this is that answer, without either call. Anything else takes the two
           * calls, unchanged. `rawTextOf` answers a string.
           */
          const text = rawTextOf(value);
          const tail = styleTails[i]!;
          out =
            tail !== 0 && text.indexOf('</') === -1 && (tail === 1 || text.charCodeAt(text.length - 1) !== 60)
              ? out + text
              : styleHole(out, escapeRawText(text, 'style'), part, parts[i + 1]!);
        }
        else if (raws[i]) out += escapeRawText(rawTextOf(value), raws[i]);
        else out += serializeValue(value, false, depths[i], texts[i]);
        break;
      case ATTRIBUTE: {
        /** Every ATTRIBUTE slot has its group — `compile` sets the two together. */
        const group = groups[i]!;
        /**
         * ONE conversion, the platform's own (`String`, as `setAttribute` does): the URL check reads the very
         * string that is written, so a value whose `toString` answers differently each time cannot pass the
         * check with one answer and be written with another.
         */
        const text = serializeValue(value, true);
        /** Assembled two ways — one hole that is the whole value, or holes joined with statics — and escaped by one function. */
        if (group.sole) {
          attribute = group.open + escapeHtml(text);
          joined = text;
        } else {
          if (group.first === i) {
            attribute = group.open;
            joined = '';
          }
          attribute += leads[i] + escapeHtml(text);
          /** Only a URL sink needs the value the client would join. */
          if (group.refuse > 1) joined += decodedLeads[i] + text;
          if (group.last !== i) break;
          attribute += group.suffix;
          if (group.refuse > 1) joined += group.decodedSuffix;
        }
        /**
         * ONE decision for every shape, written whole or not at all: a sole nullish value removes the attribute,
         * and a bound srcdoc or a `javascript:` URL is refused — as the client decides each of them.
         */
        if (group.refuse === 1) break;
        /**
         * A nullish sole value and a refused URL REMOVE the attribute on the client (`removeAttribute`), an earlier
         * static write of the name included (`<a title=x title=${null}>` renders `<a>`) — so the strip comes first.
         */
        if (group.strip) out = removeAttribute(out, group.name);
        if (group.sole && value == null) break;
        if (group.refuse > 1 && (group.refuse === 3 ? SCRIPT_URL_ITEM : SCRIPT_URL).test(joined)) {
          refusedScriptUrl(group.name);
          break;
        }
        out += attribute + '"';
        break;
      }
      case BOOLEAN:
        if (strip[i]) out = removeAttribute(out, names[i]);
        if (value) out += ` ${names[i]}=""`;
        break;
      case CONTENT:
        pendingText = serverContent(value, owners[i], names[i], depths[i]);
        pendingStrip = owners[i];
        break;
      case FORM_PROP:
        if (!FORM_ELEMENTS.has(owners[i])) break;
        /**
         * A `<textarea>`'s value is its **text content**. `<textarea value="x">` is ignored by
         * every parser, so writing the attribute served an empty control while the client — which
         * sets the property — showed the text. Held until the tag closes, because that is where the
         * content goes; see `pendingText` below.
         */
        /**
         * A `<select>`'s `value` is not an attribute — see `SELECT_MARK`. Marked here and resolved
         * once the options exist; writing ` value="b"` on the tag, which is what this used to do,
         * means nothing to a parser and left the control showing its first option.
         */
        if (owners[i] === 'select' && (names[i] === 'value' || names[i] === 'selectedIndex')) {
          if (strip[i]) out = removeAttribute(out, names[i]);
          out += ` ${SELECT_MARK}="${selectValues.push(selection(names[i], value)) - 1}"`;
          break;
        }
        if (owners[i] === 'textarea' && names[i] === 'value') {
          /**
           * `null` and `undefined` are **not** the same value here, and treating them as one is what
           * this used to do. `value` carries `[LegacyNullToEmptyString]` in its IDL, so assigning
           * `null` gives `''` while `undefined` goes through the ordinary ToString and gives the text
           * `"undefined"` — measured in Chromium, Firefox and WebKit, since that is the platform's
           * rule and not this package's to guess. A `== null` test collapses them.
           *
           * The booleans used to be emptied too, which disagreed with `<input>` **one branch below**
           * — the same property, on the same rule, serialized by a different branch: `true` served an
           * empty `<textarea>` against the browser's `true`.
           */
          pendingText = value === null ? '' : escapeHtml(value);
          break;
        }
        if (strip[i]) out = removeAttribute(out, names[i]);
        if (BOOLEAN_FORM_PROPERTIES.has(names[i])) {
          if (value) out += ` ${names[i]}=""`;
        } else if (value !== null || owners[i] === 'option') {
          /**
           * A string property: `true` is `"true"`, exactly as assigning it to the element gives.
           *
           * Three rules, not one, and they were measured rather than assumed:
           *
           * - `<input>` and `<textarea>` carry `[LegacyNullToEmptyString]`, so `null` means the empty
           *   string. Omitting the attribute is how markup says that — a parsed `<input>` with no
           *   `value` answers `''`.
           * - `<option>` does **not**. `option.value = null` is the text `"null"` in every engine, and
           *   omitting the attribute is worse than wrong there: `option.value` then falls back to the
           *   element's own text.
           * - `undefined` is never the empty string on any of them. It is `"undefined"`, which looks
           *   like a bug because it *is* one — but it is the client's bug too, and the two sides
           *   disagreeing about it is a hydration mismatch on top of it.
           */
          out += ` ${names[i]}="${escapeHtml(value)}"`;
        }
        break;
      case COMPONENT_PROP:
        /**
         * Delivered only when the tag is REGISTERED — a component this process will render, whose
         * server output should come from the same data its client render gets. An unregistered
         * dashed tag (client-only, autoloaded later) is left exactly as before: the tag passes
         * through as markup, the property is the client's to apply, nothing here to receive it.
         * Registration is asked per render, not per plan, because the registry fills as component
         * modules execute.
         */
        if (registry.has(owners[i]) && !(urls[i] && value != null && SCRIPT_URL.test(`${value}`))) {
          adoption ??= { instances: new Map(), mark: '' };
          deliverProperty(claimInstance(adoption, elements[i], owners[i]), owners[i], names[i], value);
          if (adoption.mark !== '') {
            out += adoption.mark;
            adoption.mark = '';
          }
        }
        break;
      /** DROPPED: '@' and '&' and a non-component, non-form '.' or '!': nothing — client concerns. */
    }
  }
  const tail = parts[kinds.length];
  const finished = pendingText === null ? out + tail : out + insertContent(tail, pendingText, pendingStrip);
  return selectValues.length ? resolveSelects(finished, selectValues) : finished;
};

/**
 * Puts `text` inside the element the static closes, replacing what the author wrote there.
 *
 * Only `<textarea>` needs this, and only for `.value` — every other form property is an attribute.
 * `<textarea .value=${x}>anything</textarea>` must serve `x`, because that is what the element
 * will hold on the client the moment the property is assigned.
 */
/**
 * A `<select>` has **no `value` content attribute**. Assigning the property *selects an option*, so
 * the only way markup can express it is `<option selected>` on the matching one — which is what
 * React's server renderer does, and what this does. Lit's SSR drops the binding entirely and serves
 * a control showing the wrong option.
 *
 * The mark is an index into a per-render list rather than the value itself, so nothing has to be
 * escaped on the way in and unescaped on the way out; it is removed again by `resolveSelects`, and
 * removing it is what terminates that loop.
 *
 * `selectedIndex` chooses an option too, by position rather than by value, so it rides the same mark: the list holds
 * a string for `value` and a number for `selectedIndex`. A tag carrying two marks resolves to its LAST, because on the
 * client the later assignment is the one that stands: `resolveSelects` reads every mark on the tag, keeps the last,
 * and removes them all.
 */
const SELECT_MARK = 'data-vm-select';
/**
 * What a `<select>` binding asks for: the value's string, or the index as the platform converts it — `selectedIndex`
 * is a WebIDL `long`, and `| 0` is exactly its conversion (ToInt32: `'1'` is 1, `null` and `NaN` are 0, 1.7 is 1).
 */
// eslint-disable-next-line no-bitwise -- ToInt32, exactly the WebIDL `long` conversion described above
const selection = (name: string, value: unknown): string | number => (name === 'value' ? `${value}` : (value as number) | 0);
const NAMED: Partial<Record<string, string>> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * Enough of a decoder to compare an option against a value.
 *
 * Everything this serializer writes is escaped as a numeric reference, and the five named ones are
 * what an author writes by hand. A full entity table would be several kilobytes to decide which
 * `<option>` is selected, and anything it missed would simply fail to match — which is the same
 * outcome as an option that genuinely does not match, and is already a documented divergence.
 */
const decodeRefs = (text: string): string =>
  /** Most option text holds no reference: one native search, and no regex or callback, answers it. */
  text.indexOf('&') === -1
    ? text
    : text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (whole: string, dec?: string, hex?: string, name?: string) =>
    /** Neither number matched, so the name did. */
    dec ? decodeCodePoint(+dec) : hex ? decodeCodePoint(parseInt(hex, 16)) : NAMED[name!] ?? whole
  );

/**
 * What an engine reports for `option.value` when the option has no `value` attribute: its text **stripped and
 * collapsed**, measured in Chromium, Firefox and WebKit — `tests/browser/select-value.test.js` — because the fallback
 * is easy to assume is the raw text, and it is not. The text runs to the next tag that ends an option.
 */
const optionText = (content: string, from: number): string => {
  let to = content.length;
  for (let at = content.indexOf('<', from); at !== -1; at = content.indexOf('<', at + 1)) {
    /** The character after `<` decides which names can follow, so a `<` opening any other tag costs no call. */
    let c = content.charCodeAt(at + 1);
    if (c >= 65 && c <= 90) c += 32;
    if (c === 47 ? isTagAt(content, at, '/option') || isTagAt(content, at, '/optgroup') || isTagAt(content, at, '/select') : c === 111 && (isTagAt(content, at, 'option') || isTagAt(content, at, 'optgroup'))) {
      to = at;
      break;
    }
  }
  return decodeRefs(content.slice(from, to)).replace(/[\t\n\f\r ]+/g, ' ').trim();
};

/**
 * Marks the first option matching `wanted`, and clears any `selected` the author wrote.
 *
 * Clearing is not tidiness: a property assignment overrides markup, so `<option selected>` beside a
 * `.value` binding loses on the client and has to lose here too. **First match wins**, which is the
 * engines' rule for duplicate values. An option's `value` is the first attribute of that name the parser keeps, read
 * by `readTag`: never `data-value`, nor `value=` inside another value.
 *
 * When nothing matches, nothing is marked — and that is a divergence markup cannot close. The client
 * leaves `selectedIndex` at `-1` with nothing showing; a parsed `<select>` with no selected option
 * takes its **first**. See the SSR README. An index is the same: one out of range — `-1` included — selects nothing
 * on the client, and marks nothing here.
 */
const markSelected = (content: string, wanted: string | number): string => {
  /**
   * With no `selected` anywhere in the options there is nothing to clear, so the chosen option is the input plus one
   * ` selected` and nothing after it is read (the old pattern's early return, on the parser's reading of the tag).
   * Only a `selected` to clear walks every option and rebuilds the content.
   */
  const clear = content.toLowerCase().includes('selected');
  const spans: number[] = [];
  let out = '';
  let last = 0;
  let index = 0;
  let marked = false;
  for (let start = nextTag(content, 'option', 0); start !== -1; start = nextTag(content, 'option', last)) {
    spans.length = 0;
    /** `<option>` with no attributes ends at its `>`: nothing to read. */
    const end = content.charCodeAt(start + 7) === 62 ? start + 8 : readTag(content, start, spans);
    /** Where ` selected` goes: after the last attribute kept, or after the tag name. */
    let insertAt = start + 7;
    let value: string | undefined;
    let open = '';
    let from = start;
    for (let k = 0; k < spans.length; k += 6) {
      if (nameIs(content, spans[k + 1]!, spans[k + 2]!, 'selected')) {
        open += content.slice(from, spans[k]);
        from = spans[k + 5]!;
      } else {
        insertAt = spans[k + 5]!;
        if (value === undefined && nameIs(content, spans[k + 1]!, spans[k + 2]!, 'value'))
          value = spans[k + 3] === -1 ? '' : decodeRefs(content.slice(spans[k + 3], spans[k + 4]));
      }
    }
    const chosen = !marked && (typeof wanted === 'number' ? index === wanted : (value ?? optionText(content, end)) === wanted);
    index++;
    if (!clear) {
      if (chosen) return `${content.slice(0, Math.max(start, insertAt))} selected>${content.slice(end)}`;
      last = end;
      continue;
    }
    if (chosen) {
      marked = true;
      open += `${content.slice(from, Math.max(from, insertAt))} selected>`;
    } else open += content.slice(from, end);
    out += content.slice(last, start) + open;
    last = end;
  }
  return clear ? out + content.slice(last) : content;
};

/**
 * The next `<select` at or after `from` that may carry the mark: found by searching for the mark's text and stepping
 * back to the `<` before it (one native search per select, where walking every `<` of the markup was most of a cold
 * select's cost). When that `<` is not a select's (the mark's text sits elsewhere, or a static quoted value of the tag
 * holds a `<`), the exact walk answers instead. The caller still proves the mark is one of the tag's attributes.
 */
const nextMarkedSelect = (markup: string, from: number): number => {
  const mark = markup.indexOf(SELECT_MARK, from);
  if (mark === -1) return -1;
  const at = markup.lastIndexOf('<', mark);
  return at >= from && isTagAt(markup, at, 'select') ? at : nextTag(markup, 'select', from);
};

/**
 * Resolves every marked `<select>` once its options are in the string — see `SELECT_MARK`. Each select's open tag is
 * read by `readTag`, so its end is the parser's (a `>` inside a quoted title is not it) and its mark is an attribute
 * of its own, never text inside another value.
 */
const resolveSelects = (markup: string, wanted: ReadonlyArray<string | number>): string => {
  let out = '';
  let last = 0;
  for (let start = nextMarkedSelect(markup, 0); start !== -1; start = nextMarkedSelect(markup, start + 1)) {
    const spans: number[] = [];
    const end = readTag(markup, start, spans);
    let mark = -1;
    let open = '';
    let from = start;
    for (let k = 0; k < spans.length; k += 6)
      if (nameIs(markup, spans[k + 1]!, spans[k + 2]!, SELECT_MARK)) {
        /** The LAST mark stands: the client's later assignment is the one that holds. */
        mark = +markup.slice(spans[k + 3], spans[k + 4]);
        open += markup.slice(from, spans[k]);
        from = spans[k + 5]!;
      }
    if (mark === -1) continue;
    const closeAt = nextTag(markup, '/select', end);
    const contentEnd = closeAt === -1 ? markup.length : closeAt;
    out += markup.slice(last, start) + open + markup.slice(from, end) + markSelected(markup.slice(end, contentEnd), wanted[mark]!);
    last = contentEnd;
    start = Math.max(start, contentEnd - 1);
  }
  return out + markup.slice(last);
};

/** The type that makes a classic script inert; written FIRST, so the parser's first-duplicate-wins rule defeats any author `type`. */
const INERT_TYPE = ' type="text/x-vera-inert"';
/**
 * **Trusted `innerHTML` markup, made to behave as an `innerHTML` ASSIGNMENT rather than as parsed page markup** —
 * inert, and self-contained. The two parses differ in exactly two ways a served page would otherwise run: a
 * `<script>` executes when the browser parses it from the response but never when assigned through `innerHTML`, and a
 * `<template shadowrootmode>` attaches a shadow root when parsed but not when assigned. Both are neutralized wherever
 * the tokenizer reads a start tag — never inside a comment, an attribute value or raw text, which `innerHTML` does not
 * act on either — so the served page matches the client's assignment, and hydration (which re-assigns) agrees.
 *
 * **The tags come from `scanTag`, the scan every template gets.** This used to run its own mini-tokenizer, and the two
 * drifted: it read a quote inside an attribute NAME as opening a value, so `<b x"><script>` served live, and it
 * skipped `<style>` content inside `<svg>`, where it is markup, so `<svg><style><script>` served live. Reading a tag
 * where the browser does not is only ever safe in one direction — over-neutralizing a `<script` that was text makes
 * an inert thing inert — and `scanTag` errs that way wherever it is deliberately incomplete (see its foreign depth).
 *
 * Whatever the markup leaves open is closed, so it cannot reach the host's parent: its comment, raw-text element and
 * svg/math/noscript/select/template (`closersOf`); a `<plaintext>`, which nothing closes, is refused. An UNFINISHED tag is dropped, as an assignment's parser drops it at the
 * end of input — served, it swallowed the page's next markup into its attributes. A `<` or `</` that never started a
 * tag is text, written escaped, so the host's own end tag cannot become the rest of it.
 */
const fortify = (markup: string, depth: number): string => {
  const edits: number[] = [];
  const end = scanTag(markup, freshScan(depth), edits);
  /** The one thing nothing closes: a `<plaintext>` (see `compile`). An assignment contains it; a served page does not. */
  if (end.textTag === 'plaintext') throw refusal('ssr-plaintext');
  let stop = markup.length;
  let tail = '';
  if (end.phase === TAG_OPEN || end.phase === END_TAG_OPEN) {
    stop = end.tagAt;
    tail = '&lt;' + markup.slice(stop + 1);
  } else if (end.inTag) {
    stop = end.tagAt;
    /** An unfinished END tag of the raw-text element it was ending leaves that element open — so it is closed. */
    if (end.closing && end.foreign === 0 && (RAWTEXT.has(end.tagName) || TEXT_ONLY.has(end.tagName))) tail = `</${end.tagName}>`;
  }
  let out = '';
  let from = 0;
  for (let i = 0; i < edits.length && edits[i] < stop; i += 2) {
    const at = edits[i];
    out += markup.slice(from, at) + (edits[i + 1] === EDIT_INERT ? INERT_TYPE : 'data-vera-');
    from = at;
  }
  return out + markup.slice(from, stop) + tail + closersOf(end);
};

/**
 * **A value written into a `<style>`, with every closer it takes part in neutralized** (2026-11-18). `</style` (any
 * case) ends the element wherever it is formed, and it can be formed ACROSS a hole: the static before a value and the
 * value (`"<${'/style><img…>'}"`), the value and the static after, or several values. A closer is 7 characters, so one
 * that crosses this hole lies within the 6 characters already written, the value, and the next static's first 6; each
 * such closer gets a `\` before its `/` (`<\/style`, the same CSS), wherever the `/` falls — in what is written, the
 * value, or the next static (the `\` then goes after the value). A closer wholly inside the next static is the element's
 * own end tag, and one wholly in what was written was dealt with at its own hole. Statics alone never hold a closer, so
 * the output is the composed text's: byte for byte what a client writes.
 */
const styleHole = (out: string, value: string, before: string, next: string): string => {
  /**
   * What was written last, read from the static just written when it holds 6 characters — `out` is the whole document
   * so far, and slicing it flattens that string on every hole (measured: most of a page's style-hole cost, 2026-11-18).
   * A closer crossing this hole starts with a `<` in it or in the value; with neither, nothing crosses.
   */
  const tail = before.length >= 6 ? before.slice(-6) : out.slice(-6);
  if (!value.includes('<') && !tail.includes('<')) return out + value;
  const head = next.slice(0, 6);
  const window = tail + value + head;
  const start = tail.length;
  const stop = start + value.length;
  /** Where, in the window, a `\` goes: before each crossing closer's `/`. */
  const at: number[] = [];
  for (const match of window.matchAll(/<\/style/gi)) {
    const m = match.index;
    if (m < stop && m + 7 > start) at.push(m + 1);
  }
  if (at.length === 0) return out + value;
  let written = out.slice(0, out.length - tail.length);
  let from = 0;
  const marked = window.slice(0, stop);
  for (const p of at) {
    written += marked.slice(from, Math.min(p, stop)) + '\\';
    from = Math.min(p, stop);
  }
  return written + marked.slice(from);
};

/**
 * The content a `.innerHTML`/`.textContent` binding writes after the host's open tag. `innerHTML` is
 * `[LegacyNullToEmptyString]` (so `null` is `''` but `undefined` is `"undefined"`); `textContent` is nullable (both
 * are `''`) — measured against a browser, not guessed. The host decides escaping: a RAWTEXT host (`<style>`,
 * `<script>`) neutralizes its own close tag and is otherwise raw; a text-only or foreign host, and any
 * `textContent`, is escaped text; only `innerHTML` on an ordinary HTML host is live markup, made inert first.
 */
const serverContent = (value: unknown, owner: string, property: string, depth: number): string => {
  const text = value === null || (value === undefined && property === 'textContent') ? '' : `${value}`;
  if (RAWTEXT.has(owner)) return escapeRawText(text, owner);
  if (property === 'textContent' || TEXT_ONLY.has(owner) || owner === 'noscript' || depth > 0) return escapeHtml(text);
  return fortify(text, depth);
};

const insertContent = (staticText: string, text: string, strip: string): string => {
  const close = staticText.indexOf('>');
  if (close === -1) return staticText;
  const rest = staticText.slice(close + 1);
  const end = closerAt(rest, 0, strip);
  /** One line feed for the parser to take, always — the client sets this content through the DOM (see `takesNewline`). */
  const guard = NEWLINE_TAKERS.has(strip) ? '\n' : '';
  return staticText.slice(0, close + 1) + guard + text + (end === -1 ? rest : rest.slice(end));
};

/**
 * Fold resolved spread bindings into the tag being built, mirroring what the client does.
 *
 * Appending is not enough, and the difference is a correctness bug rather than a nicety.
 * `<input type="text" ${spread({ type: 'number' })}>` appends a second `type`, and an HTML parser
 * keeps the **first** duplicate — so the server would render `type="text"` while the client, where
 * `setAttribute` overwrites, renders `type="number"`. Same template, two answers, and a hydration
 * mismatch between them.
 *
 * So a spread key removes any attribute of that name already written into the open tag before
 * adding its own — including when it adds nothing, because `?disabled: false` and `id: null` both
 * *remove* on the client and must remove here too. Kinds that never touch attributes client-side
 * (events, non-form properties) leave the tag alone.
 *
 * Splitting on the last `<` is safe: attribute values are escaped, so no raw `<` can appear inside
 * one.
 */
/**
 * Removes an attribute already written into the open tag being built, so the last write wins.
 *
 * An HTML parser keeps the **first** of a duplicate pair; `setAttribute` on the client overwrites,
 * so the **last** wins there. `<b title="a" title=${x}>` therefore showed `a` on a server-rendered
 * page and `b` in the browser — the same disagreement `foldSpread` was written to fix for spreads,
 * which is where this logic came from. It applies to anything that writes a name into the tag.
 */
/** Whitespace as the HTML tokenizer reads it between attributes: tab, LF, FF, CR and space. */
const tagSpace = (c: number): boolean => c === 32 || c === 9 || c === 10 || c === 12 || c === 13;

/**
 * **An open tag, read as the parser reads it** (2026-11-21): the one reader behind every edit this serializer makes
 * to markup it already wrote — removing a name before it is written again, finding a `<select>`'s mark, an option's
 * `value` and its `selected` — and behind finding where such a tag ENDS. `text[from]` is the tag's `<`. For each
 * attribute it pushes six offsets into `spans`: where its removal starts (the one whitespace before its name, when
 * there is one), its name's start and end, its value's start and end (`-1` for none; inside the quotes), and its end.
 * Answers the offset just past the tag's `>`, or `text.length` when the tag does not close.
 *
 * The patterns it replaced had no end to the name and did not see quotes, so they matched text the parser reads as
 * a value: removing `id` matched ` id=b"` inside `title="a id=b"` and served the rest of a spread's value as live
 * attributes (an `onfocus` handler, measured), removing `src` cut `srcset=` to `set=`, an option's `value` was read
 * from `data-value` or from a title holding `value=b`, and `[^>]*` ended an option or a select at a `>` inside a
 * quoted value, so an author's `selected` survived beside the chosen one and the select's mark was served.
 */
const readTag = (text: string, from: number, spans: number[]): number => {
  /** `tagSpace` is written out at each test (space, tab, LF, FF, CR): this runs for every option of every bound select, cold. */
  const n = text.length;
  let i = from + 1;
  let c = 0;
  while (i < n && !((c = text.charCodeAt(i)) === 32 || (c >= 9 && c <= 13 && c !== 11)) && c !== 47 && c !== 62) i++;
  for (;;) {
    /** A `/` not before `>` is read as a separator, as the parser reads it. */
    while (i < n && (((c = text.charCodeAt(i)) === 32 || (c >= 9 && c <= 13 && c !== 11)) || c === 47)) i++;
    if (i >= n) return n;
    if (c === 62) return i + 1;
    const nameFrom = i;
    /** The first character is part of the name whatever it is, `=` included: the parser's rule. */
    i++;
    while (i < n && !((c = text.charCodeAt(i)) === 32 || (c >= 9 && c <= 13 && c !== 11)) && c !== 47 && c !== 62 && c !== 61) i++;
    const nameTo = i;
    let valueFrom = -1;
    let valueTo = -1;
    let j = i;
    while (j < n && ((c = text.charCodeAt(j)) === 32 || (c >= 9 && c <= 13 && c !== 11))) j++;
    if (j < n && text.charCodeAt(j) === 61) {
      j++;
      while (j < n && ((c = text.charCodeAt(j)) === 32 || (c >= 9 && c <= 13 && c !== 11))) j++;
      const quote = j < n ? text.charCodeAt(j) : 0;
      if (quote === 34 || quote === 39) {
        const close = text.indexOf(text[j]!, j + 1);
        valueFrom = j + 1;
        valueTo = close === -1 ? n : close;
        i = close === -1 ? n : close + 1;
      } else {
        /** Unquoted, a quote is part of the value (`title=a"b`), as the parser reads it. */
        valueFrom = j;
        while (j < n && !((c = text.charCodeAt(j)) === 32 || (c >= 9 && c <= 13 && c !== 11)) && c !== 62) j++;
        valueTo = i = j;
      }
    }
    spans.push(nameFrom > from + 1 && ((c = text.charCodeAt(nameFrom - 1)) === 32 || (c >= 9 && c <= 13 && c !== 11)) ? nameFrom - 1 : nameFrom, nameFrom, nameTo, valueFrom, valueTo, i);
  }
};

/**
 * Whether `text[from, to)` is `name`, ASCII case-insensitively — A–Z folded and nothing else, as the tokenizer
 * lowercases a name. `toLowerCase` folds more (U+212A KELVIN SIGN to `k`), so a name the parser keeps apart matched.
 */
const nameIs = (text: string, from: number, to: number, name: string): boolean => {
  if (to - from !== name.length) return false;
  for (let k = 0; k < name.length; k++) {
    let a = text.charCodeAt(from + k);
    let b = name.charCodeAt(k);
    if (a >= 65 && a <= 90) a += 32;
    if (b >= 65 && b <= 90) b += 32;
    if (a !== b) return false;
  }
  return true;
};

/** Whether `text[at]` opens `<name` (the name ASCII case-insensitive, then a space, `/`, `>` or the end). */
const isTagAt = (text: string, at: number, name: string): boolean => {
  const after = at + name.length + 1;
  if (after > text.length) return false;
  for (let k = 0; k < name.length; k++) {
    let c = text.charCodeAt(at + 1 + k);
    if (c >= 65 && c <= 90) c += 32;
    if (c !== name.charCodeAt(k)) return false;
  }
  if (after === text.length) return true;
  const c = text.charCodeAt(after);
  return tagSpace(c) || c === 47 || c === 62;
};

/**
 * The next `<name` tag at or after `from` (see `isTagAt`), or -1. `name` is lowercase; the character after each `<` is
 * folded A–Z and compared inline first, so a `<` that opens another tag costs no call (the select path's walk was most
 * of its cost).
 */
const nextTag = (text: string, name: string, from: number): number => {
  const first = name.charCodeAt(0);
  for (let at = text.indexOf('<', from); at !== -1; at = text.indexOf('<', at + 1)) {
    let c = text.charCodeAt(at + 1);
    if (c >= 65 && c <= 90) c += 32;
    if (c === first && isTagAt(text, at, name)) return at;
  }
  return -1;
};

/** `tag` without any attribute named `name`. Every copy goes: see `stripAttribute`. */
const withoutAttribute = (tag: string, name: string): string => {
  const spans: number[] = [];
  readTag(tag, 0, spans);
  for (let k = spans.length - 6; k >= 0; k -= 6) if (nameIs(tag, spans[k + 1]!, spans[k + 2]!, name)) tag = tag.slice(0, spans[k]) + tag.slice(spans[k + 5]);
  return tag;
};

/**
 * A name that cannot be written into a tag safely.
 *
 * A spread's keys are the one part of a template that is runtime data — that is what the module is
 * for — and they were interpolated into the open tag with no check at all, while every *value*
 * around them was escaped. A key carrying a quote or a `>` therefore closed the attribute, or the
 * element:
 *
 *     spread({ 'x><script>alert(1)</script': '1' })
 *     -> <b x><script>alert(1)</script="1">x</b>
 *
 * The set is the HTML attribute-name restriction — control characters, whitespace, `"`, `'`, `>`,
 * `/`, `=` — plus `<` and a backtick, which the specification permits and no real name uses.
 *
 * It is deliberately **stricter than `setAttribute`**, which was measured in Chromium and accepts
 * `"`, `'` and `<` while rejecting whitespace, `>`, `=`, `/` and NUL. A name the platform accepts
 * but markup cannot carry is unusable in a framework that server-renders, so `@verajs/renderer/spread`
 * applies this same rule client-side and the two sides agree on every key rather than one of them
 * quietly serving different markup.
 *
 * The control-character range is the point of the rule, not a mistake in it: a name carrying one
 * is exactly what must never reach markup.
 */
// eslint-disable-next-line no-control-regex
export const UNSAFE_ATTRIBUTE_NAME = /^$|[\s"'>/=<`]|[\u0000-\u001f\u007f]/;

/**
 * Strips an attribute out of an open tag, every copy of it, and the one place that knows how (through
 * `readTag`).
 *
 * `foldSpread` once had its own copy of this, character for character — so a fix to one was a fix
 * to one. Every copy goes because the parser keeps the FIRST of a duplicate name and the client's
 * write replaces the one it parsed, so an earlier copy left behind would be the one served.
 */
const stripAttribute = (tag: string, name: string): string =>
  /**
   * Almost no tag carries the name, and a substring search settles that far faster than reading the
   * tag's attributes does. Case-insensitive, as names are.
   */
  tag.toLowerCase().includes(name.toLowerCase()) ? withoutAttribute(tag, name) : tag;

const removeAttribute = (out: string, name: string): string => {
  const tagStart = out.lastIndexOf('<');
  if (tagStart === -1) return out;
  return out.slice(0, tagStart) + stripAttribute(out.slice(tagStart), name);
};

/**
 * One resolved spread key, as `@verajs/renderer/spread`'s server half (`_$attrs$`) hands it over: `a`ttribute,
 * `b`oolean, `p`roperty, `e`vent or `r`ef, its name, and its value with every refusal already applied.
 */
type SpreadEntry = readonly [kind: 'a' | 'b' | 'p' | 'e' | 'r', name: string, value: unknown];

/** A spread at element position: the branded result whose server half resolves its keys. */
type Spread = { readonly _$attrs$: () => readonly SpreadEntry[] };

/** What folding a spread answers: the markup so far, and content or a selection that belongs after the tag. */
type Folded = { readonly out: string; readonly text: string | null; readonly select: string | number | null };

const foldSpread = (
  out: string,
  /** The tag the spread sits in, as the template's scan named it (see `compile`). */
  owner: string,
  entries: readonly SpreadEntry[],
  deliverProp: ((name: string, value: unknown) => void) | undefined
): Folded => {
  const tagStart = out.lastIndexOf('<');
  let tag = out.slice(tagStart);
  let added = '';
  /** A `<textarea>`'s value is its text content, so a `.value` key here is not an attribute. */
  let text: string | null = null;
  /** A `<select>`'s value is not an attribute either; the caller marks the tag — see `SELECT_MARK`. */
  let select: string | number | null = null;

  const isFormElement = FORM_ELEMENTS.has(owner);
  for (const [kind, name, value] of entries) {
    /**
     * A property key on a rendered component tag is handed to the caller's delivery — the same
     * door the written `.prop=${…}` form takes, because `props()` IS a spread and a key must mean
     * the same thing in both spellings. The callback exists only when the owner is a registered
     * component; everywhere else the key falls through to the rules below unchanged.
     */
    if (kind === 'p' && deliverProp !== undefined) {
      deliverProp(name, value);
      continue;
    }
    const serializes =
      kind === 'a' || kind === 'b' || (kind === 'p' && isFormElement && isFormProperty(owner, name));
    if (!serializes) continue;

    /**
     * Dropped, and dropped **before** anything is done with the name — `stripAttribute` compiles it
     * into a pattern, so an unchecked name is a second way in.
     *
     * Silent here on purpose. A key that reaches this is either a mistake, which the identical check
     * in `@verajs/renderer/spread` reports in development where the author will see it, or it is
     * hostile — and a server that logs a line per hostile key hands an attacker the log file.
     */
    if (UNSAFE_ATTRIBUTE_NAME.test(name)) continue;

    /** Quoted, single-quoted, unquoted, or valueless — whatever the template author wrote. */
    tag = stripAttribute(tag, name);

    /**
     * A `<textarea>`'s `.value` is its **content**, exactly as it is for a written binding — the
     * attribute this would otherwise write is ignored by every parser, so the control arrived empty
     * while the client, which sets the property, showed the text. The written form was fixed and
     * this one was not: a spread key means what the written binding means, always.
     */
    if (kind === 'p' && owner === 'select' && (name === 'value' || name === 'selectedIndex')) {
      /** A spread key means what the written binding means, always — see `SELECT_MARK`. */
      select = selection(name, value);
      continue;
    }
    if (kind === 'p' && owner === 'textarea' && name === 'value') {
      text = value === null ? '' : escapeHtml(value);
      continue;
    }

    /**
     * Same coercions as a written binding, kind by kind — which is the contract, and which this had
     * only approximately.
     *
     * A **boolean** is truthiness, and so are `checked` and `selected`. A plain **attribute** takes
     * anything that is not nullish, `false` included: `String(false)` is `"false"`, which is what
     * `setAttribute` writes and what the written form already emitted. Treating `false` as removal
     * for every kind meant `${spread({ title: false })}` dropped the attribute while
     * `title=${false}` kept it — the same value, two answers, from the two spellings of one binding.
     */
    if (kind === 'b' || (kind === 'p' && BOOLEAN_FORM_PROPERTIES.has(name))) {
      if (value) added += ` ${name}=""`;
    } else if (kind === 'p') {
      /**
       * **A string form property and a plain attribute are no longer the same rule**, which is why
       * this branch split. An attribute is removed by either nullish value — the renderer's own
       * documented behavior, matching lit, on both sides. A `value` property is not: its IDL carries
       * `[LegacyNullToEmptyString]` on `<input>` and `<textarea>`, so `null` alone means the empty
       * string, `undefined` is the text `"undefined"`, and `<option>` has neither rule and takes
       * `"null"`. Written and spread must agree about all of it —
       * `tests/ssr-spread-equivalence.test.mjs` is what caught this one, and it caught it the same
       * afternoon the written form was corrected.
       */
      if (value !== null || owner === 'option') added += ` ${name}="${escapeHtml(value)}"`;
    } else if (value != null) {
      /**
       * A plain attribute takes anything not nullish and is removed by either nullish value.
       * `false` is `"false"` and `true` is `"true"`, because that is what `setAttribute` produces.
       */
      added += ` ${name}="${escapeHtml(serializeValue(value, true))}"`;
    }
  }

  /**
   * The element-position slot already carries the separating space, so the first addition drops its
   * own. When a spread contributes nothing — every key nullish, or all of them client concerns —
   * that space is left dangling before the `>`, which the parser ignores and which is still a byte
   * in every response and untidy in a view-source.
   */
  return {
    out: out.slice(0, tagStart) + (added ? tag + added.slice(1) : tag.replace(/ $/, '')),
    /** Written into the next static, after the `>` that closes this tag — see `insertContent`. */
    text,
    select,
  };
};

/**
 * Exported so the renderer can flatten a non-template return the same way a slot does — see
 * `index.js`. Everything about what renders and how it escapes lives here and only here.
 */
/**
 * An object value as `serializeValue` probes it: any of these may be present, holding anything — a forgery from
 * `JSON.parse` included — so each is tested before it is trusted.
 */
type Probed = {
  readonly strings?: unknown;
  readonly $h?: unknown;
  readonly _$attrs$?: unknown;
  readonly _$child$?: unknown;
  readonly [Symbol.iterator]?: unknown;
};

/**
 * **Out of line on purpose: `serializeValue` must stay under V8's inlining budget.** It is inlined into
 * `serializeTemplate`'s per-binding loop only while its bytecode is at most 460 bytes (`--max-inlined-bytecode-size`), and
 * it sat at 455: the DOM-node case (2026-10-09) took it to 467 and cost 3.6% steady on renders that never reach the
 * case — any statement did (a never-taken branch alone measured +4.0%). A refusal's error construction is the cheapest
 * thing to move out: it runs once, at the throw.
 */
const refuseTemplateInText = (): never => {
  throw own(new Error(ssrMisuse('ssr-template-in-text', PROSE['ssr-template-in-text']!())));
};

/**
 * **A value in a `<style>` or JSON data block, as text** — the rule `<textarea>`/`<title>` already follow, and every
 * client writes (2026-11-18): nothing for `null`/`undefined`, a list its items' text (nested lists flattened by the same
 * rule), a template refused (`ssr-template-in-text`), anything else `String`. Before, `String(value)` wrote a list as
 * `a,b` (commas between CSS rules) and a template as `[object Object]`.
 */
const rawTextOf = (value: unknown): string => {
  /** A string first: it is most values, and its text is itself (exactly what the template literal below gives it). */
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (Array.isArray(value)) {
    let out = '';
    for (let i = 0; i < value.length; i++) out += rawTextOf(value[i]);
    return out;
  }
  if (typeof value === 'object' && isLiteral((value as Probed).strings)) refuseTemplateInText();
  return `${value}`;
};

/**
 * **A child value that applies itself (`_$child$`) renders on a server what it would show FIRST on a client** (2026-10-26,
 * found by `@verajs/renderer/until`'s server row: every such value served `[object Object]`). The applier runs against a
 * server part whose `_$commit$` keeps what it commits; the last SYNCHRONOUS commit is served, as the client's first
 * frame shows it. A commit that arrives later (a promise settling) lands on a part already served and dropped. Out of
 * line: `serializeValue` sits near V8's inlining budget (`tests/ssr-inlining-budget.test.mjs`).
 */
const serializeChild = (value: { _$child$: (this: unknown, part: unknown, previous: unknown, adopting: boolean) => unknown }, depth: number, text: boolean): string => {
  let committed: unknown;
  value._$child$.call(value, { _$commit$: (next: unknown) => { committed = next; }, $R: null }, undefined, false);
  return serializeValue(committed, false, depth, text);
};

export const serializeValue = (value: unknown, raw = false, depth = 0, text = false): string => {
  /**
   * Only `null` and `undefined` are empty, exactly as on the client — `false` and `0` render.
   * `false` used to serialize as empty here, which made `${cond && 'x'}` emit nothing on the server
   * and the text `false` in the browser: a silent content difference on a static page, and a full
   * re-render on a hydrated one.
   */
  if (value == null) return '';
  /**
   * **An attribute stringifies exactly as the platform does, and nothing else.**
   *
   * A child position renders a value — a template becomes markup, an array renders every item, a
   * function is client state and disappears. An attribute does none of that: it goes through
   * `setAttribute`, which is `String(value)` and only that. The two are different rules and this
   * had one of them.
   *
   * Measured against a browser, every one of these disagreed: `[1, 2]` served `12` against `1,2`
   * (arrays have their own `toString`), a `Set` served `1,2` against `[object Set]`, a function
   * served nothing against its own source, and a **template served its markup into an attribute
   * value** against `[object Object]`. Escaped, so not an injection — and still a completely
   * different page before and after hydration.
   */
  if (raw) return `${value}`;
  /**
   * Loops, never `map` with an arrow: an arrow capturing `depth`/`text` makes V8 heap-allocate a context on EVERY call of
   * this function, whichever branch runs — measured at about 5% of a server render.
   */
  if (Array.isArray(value)) {
    let out = '';
    for (let i = 0; i < value.length; i++) out += serializeValue(value[i], false, depth, text);
    return out;
  }
  if (typeof value === 'function') return '';
  if (typeof value === 'object') {
    /** Template-shaped (core's html, by shape) recurses. `keyed()` mutates one, so it arrives here. */
    /**
     * Inside `<textarea>`, `<title>` and the other text-only elements a template is refused: their content is text to
     * the browser, where the client's elements are never shown, and a template's markup there is the one way a value
     * can CLOSE the element — `${html`</textarea>`}` — and turn the statics after it into unchecked markup.
     */
    if ((value as Probed).strings) {
      if (text && isLiteral((value as Probed).strings)) refuseTemplateInText();
      return serializeTemplate(value as SsrTemplate, depth);
    }
    /**
     * `hold(result)` is `{ $h: result }` — a client-renderer construct that keeps the DOM of a
     * toggled-away subtree alive so form values and scroll positions survive the round trip. There
     * is no previous DOM on a server, so the wrapper means nothing here and the template inside it
     * means everything.
     *
     * It used to fall through to `String(value)` and serve the text `[object Object]` into the
     * page. `keyed()` works because it mutates the template and hands the same object back; `hold`
     * wraps one, and nothing unwrapped it.
     */
    if ((value as Probed).$h) return serializeValue((value as Probed).$h, raw, depth, text);
    /**
     * A spread (`@verajs/renderer/spread`) at element position. It hands back resolved bindings and this
     * decides what reaches markup: attributes and truthy booleans do, form properties do because
     * hydration reads them back, and events and other properties are client state. Escaping happens
     * here and only here — principle #8 puts it at the render boundary, not at the source.
     */
    if (typeof (value as Probed)._$attrs$ === 'function') return '';
    if (typeof (value as Probed)._$child$ === 'function') return serializeChild(value as never, depth, text);

    /**
     * **A DOM node writes nothing** (2026-10-09). The client inserts the node itself, and hydration's contract is that
     * the server rendered nothing for it — the renderer README's "the one thing the server cannot have rendered", which
     * adoption relies on to keep everything around it. This fell through to `String(value)` and served
     * `[object EventTarget]` into the page, which the client then refused as markup the template does not describe:
     * junk on the static page AND the whole container's adoption discarded. Before the iterable test, so a fragment
     * (whose children are a node list) never reads as a list.
     */
    if (value instanceof NodeBase) return '';

    /**
     * An iterable renders its entries, exactly as the client's child position does — a `Set` or a
     * `Map` reaching a template is not obviously deliberate, but the two sides have to agree about
     * it or hydration is discarded.
     */
    if (typeof (value as Probed)[Symbol.iterator] === 'function') {
      let out = '';
      for (const entry of value as Iterable<unknown>) out += serializeValue(entry, false, depth, text);
      return out;
    }

    /**
     * Everything else falls through to `String(value)`, which is what the client does.
     *
     * This used to return `''` for any object that was not template-shaped, and the client has
     * never agreed: a `Date` rendered its full date string there and nothing here, an object with a
     * `toString` rendered its text, a `Promise` rendered `[object Promise]`. Whether any of those is
     * a *sensible* thing to interpolate is beside the point — the two sides disagreeing is a silent
     * hydration mismatch, and matching junk is worth more than differing junk.
     *
     * A DOM node is the one exception, and it cannot occur: the server has no document to have
     * built one.
     */
  }
  /** `raw` cannot be true here — it returned at the top of the function. */
  return escapeHtml(value);
};
