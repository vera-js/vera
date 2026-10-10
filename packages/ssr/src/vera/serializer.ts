import { escapeHtml, escapeRawText } from './shim.js';
import { INLINE_HANDLER, NEWLINE_TAKERS, SCRIPT_URL, SCRIPT_URL_ITEM, URL_SINK, decodeCodePoint, decodeSchemeReferences, thrownMessage } from './escaping.js';
import { registry } from './registry.js';
import { PROSE, TWINS } from './diagnostics.js';
import { once, own, quoted, ssrMisuse, ssrWarning } from './report.js';
import { currentRenderingTag } from './stylesheets.js';
import { INSTANCE_ATTRIBUTE, markPending } from './nodes.js';
import type { ElementShim } from './nodes.js';
import type { ScanResult, ScanStart, SsrTemplate } from './types.js';
import { PHASE_END_TAG_OPEN as END_TAG_OPEN, INERT_EDIT as EDIT_INERT, RAW_TEXT_TAGS as RAWTEXT, PHASE_TAG_NAME as TAG_NAME, PHASE_TAG_OPEN as TAG_OPEN, TEXT_ONLY_TAGS as TEXT_ONLY, closersOf, freshScan, isTokenizerSpace as isSpace, scanTag } from './tokenizer.js';

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


/** The first character of a sigil binding's name — see `compile`. */
const SIGILS = new Set(['.', '?', '@', '&', '!']);
/**
 * Where a sigil or event binding's name is cut from the static before it: at the one whitespace character before the
 * name, which the binding takes with it so a dropped binding leaves no residue (`compile` then trims one more space).
 */
const nameCut = (text: string, nameAt: number): number => (nameAt > 0 && isSpace(text[nameAt - 1]) ? nameAt - 1 : nameAt);

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
 * it is attacker-shaped by definition, and a server's console is a log pipeline (vera-5a, 2026-10-09).
 */
const refusedScriptUrl = (name: string): void => {
  const tag = currentRenderingTag();
  if (once(`script-url:${tag}:${name}`)) console.warn(ssrWarning((tag ? `<${tag}>` : 'the page'), 'script-url', TWINS.scriptUrl(name)));
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
  readonly kinds: SlotKind[];
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
      if (once(`getter-only-prop:${tag}:${name}`)) console.warn(ssrWarning(`<${tag}>`, 'getter-only-prop', TWINS.getterOnlyProp(name)));
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
  if (!isLiteral(strings)) {
    /** Once per process per component (Brian, 2026-10-09); the forgery itself still renders as the object it is. */
    const tag = currentRenderingTag();
    if (once(`forged-template:${tag}`)) console.warn(ssrWarning((tag ? `<${tag}>` : 'the page'), 'forged-template', TWINS.forgedTemplate()));
    return null;
  }
  const parts: string[] = [];
  const kinds: SlotKind[] = [];
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

  /** The quote character a binding opened with, to be stripped off the front of the next static. */
  let openQuote = '';
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
    if (openQuote && part.startsWith(openQuote)) part = part.slice(1);
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
    if (taker && (tagState.foreign !== 0 || tagState.inert !== 0)) taker = false;
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
     * Whether this hole is an attribute's WHOLE value as it opens — `name=${…}`, quoted or not, with space around `=`
     * as the tokenizer allows. Only then can it be a sigil or event binding: a hole later in a value (`title="a
     * .x=${…}"`) is part of that value.
     */
    const whole = inTag && tagState.inValue && tagState.opened && tagState.valueStart === strings[i].length;
    /** Offsets are in the author's static; `part` may have lost a leading quote to the binding before it. */
    const shift = strings[i].length - part.length;
    /**
     * Names in the statics are recorded from the text that is actually **emitted**, which is the
     * part with this binding's own name already trimmed off. Scanning the raw part instead counts
     * `title=` — the binding's own name — as a prior write, and in `<b title="a" title=${x}>` the
     * two collapse into one entry, so the real duplicate goes unnoticed.
     */
    const record = (staticText: string): void => {
      if (inTag) for (const [, found] of staticText.matchAll(STATIC_ATTRIBUTE)) written.add(found.toLowerCase());
    };

    /**
     * **A sigil binding** — `.prop`, `?bool`, `@event`, `&ref`, `!live` — is an attribute whose name starts with the
     * sigil and whose whole value is this hole, however it is quoted. The name after the sigil is any name character,
     * as the client's scanner reads it: `._private` and `@_tap` are sigil bindings, and a sigil INSIDE a name is part
     * of it (`data-x.y` is an attribute). A sigil the server does not know is not inert — it would fall through to the
     * attribute path and emit an attribute named `!` — so every sigil is added here in the same pass it is added to
     * the renderer.
     */
    if (whole && SIGILS.has(tagState.attrRaw[0])) {
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
         * INSIDE — the tag's depth, plus one when the host is itself `<svg>`/`<math>` — so a `<style>` in it is read
         * the way the browser will read it. A custom-element host took the `COMPONENT_PROP` branch above.
         */
        kinds.push(CONTENT);
        depths[kinds.length - 1] = tagState.foreign + (owner === 'svg' || owner === 'math' ? 1 : 0);
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
      names.push(sigilName);
      strip.push(dynamicTag || written.has(sigilName.toLowerCase()));
      owners.push(owner);
      raws.push(tagState.rawTag);
      elementPositions.push(false);
      elements.push(elementOrdinal);
      if (sigilName) written.add(sigilName.toLowerCase());
      continue;
    }

    openQuote = '';

    /** `onClick=${fn}` — the React-shaped event binding, named as the client names it: a client concern, dropped like `@`. */
    if (whole && /^on[A-Z]/.test(tagState.attrRaw)) {
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
    if (tagState.foreign) depths[kinds.length] = tagState.foreign;
    if (tagState.textTag) texts[kinds.length] = true;
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
      throw own(new Error(ssrMisuse('tag-hole', TWINS.tagHole())));
    if (elementPosition && !tagNameHole && (NAME_CHAR_BEFORE.test(part) || NAME_CHAR_AFTER.test(strings[i + 1])))
      nameHole(part, strings[i + 1]);
    elementPositions.push(elementPosition);
    elements.push(elementOrdinal);
    /** A spread's keys are unknown until it runs, so its tag can no longer be settled here. */
    if (elementPosition) dynamicTag = true;
  }

  let last = strings[strings.length - 1];
  if (openQuote && last.startsWith(openQuote)) last = last.slice(1);
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
  if (end.inValue || (end.inTag && end.tagName))
    throw own(new Error(ssrMisuse('ssr-unfinished-tag', PROSE['ssr-unfinished-tag']!())));
  const closers = closersOf(end);
  if (closers) parts[parts.length - 1] += closers;

  /**
   * Dense, so the render loop reads a value at every binding: both are filled sparsely above, and a hole read falls
   * through to the prototype chain on every child binding of every render — measured at about 3% of a server render.
   */
  const plan: Plan = {
    parts, kinds, names, strip, owners, raws,
    depths: Array.from(kinds, (_, i) => depths[i] ?? 0),
    texts: Array.from(kinds, (_, i) => texts[i] === true),
    elementPositions, elements, groups, leads, decodedLeads, urls,
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
 * `depth` is the foreign-content depth of the position the template renders into — 0 at the top and in HTML.
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
  /** Absent on core's `html`, and `undefined > 1` is false — the answer wanted; the `!` only lets the comparison be written. */
  if (template['_$litType$']! > 1 && depth === 0) depth = 1;
  /**
   * `strings` is any value here, a forgery's included: the cast only names the key the maps hold, and `WeakMap#get`
   * answers `undefined` for a key it could never hold, which sends a forgery on to `compile`'s refusal.
   */
  const { parts, kinds, names, strip, owners, raws, depths, texts, elementPositions, elements, groups, leads, decodedLeads, urls } =
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
    const value = values[i];
    switch (kinds[i]) {
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
        else if (raws[i]) out += escapeRawText(serializeValue(value, true), raws[i]);
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
        if ((group.sole && value == null) || group.refuse === 1) break;
        if (group.refuse > 1 && (group.refuse === 3 ? SCRIPT_URL_ITEM : SCRIPT_URL).test(joined)) {
          refusedScriptUrl(group.name);
          break;
        }
        if (group.strip) out = removeAttribute(out, group.name);
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
 * client the later assignment is the one that stands. Two things each guarantee it, so either may change alone: the
 * greedy `[^>]*` in `MARKED_SELECT` reads a tag's last mark, and a pass removes only one mark, so the tag is resolved
 * again (clearing what the previous pass marked) until its last mark is gone.
 */
const SELECT_MARK = 'data-vm-select';
/**
 * What a `<select>` binding asks for: the value's string, or the index as the platform converts it — `selectedIndex`
 * is a WebIDL `long`, and `| 0` is exactly its conversion (ToInt32: `'1'` is 1, `null` and `NaN` are 0, 1.7 is 1).
 */
// eslint-disable-next-line no-bitwise -- ToInt32, exactly the WebIDL `long` conversion described above
const selection = (name: string, value: unknown): string | number => (name === 'value' ? `${value}` : (value as number) | 0);
const MARKED_SELECT = new RegExp(`<select\\b[^>]*\\s${SELECT_MARK}="(\\d+)"[^>]*>`, 'i');
const OPTION = /<option\b([^>]*)>([\s\S]*?)<\/option>/gi;
const OPTION_VALUE = /\bvalue\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
const SELECTED_ATTR = /(<option\b[^>]*?)\s+selected(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*))?/gi;
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
  text.replace(/&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|(amp|lt|gt|quot|apos));/g, (whole: string, dec?: string, hex?: string, name?: string) =>
    /** Neither number matched, so the name did. */
    dec ? decodeCodePoint(+dec) : hex ? decodeCodePoint(parseInt(hex, 16)) : NAMED[name!] ?? whole
  );

/**
 * What an engine reports for `option.value`: the `value` attribute verbatim if there is one, and
 * otherwise the option's text **stripped and collapsed**. Both halves measured in Chromium, Firefox
 * and WebKit — `tests/browser/select-value.test.js` — because the fallback is easy to assume is the
 * raw text, and it is not.
 */
const optionValue = (attributes: string, text: string): string => {
  const attribute = OPTION_VALUE.exec(attributes);
  if (attribute) return decodeRefs(attribute[1] ?? attribute[2] ?? attribute[3]);
  return decodeRefs(text).replace(/[\t\n\f\r ]+/g, ' ').trim();
};

/**
 * Marks the first option matching `wanted`, and clears any `selected` the author wrote.
 *
 * Clearing is not tidiness: a property assignment overrides markup, so `<option selected>` beside a
 * `.value` binding loses on the client and has to lose here too. **First match wins**, which is the
 * engines' rule for duplicate values.
 *
 * When nothing matches, nothing is marked — and that is a divergence markup cannot close. The client
 * leaves `selectedIndex` at `-1` with nothing showing; a parsed `<select>` with no selected option
 * takes its **first**. See the SSR README. An index is the same: one out of range — `-1` included — selects nothing
 * on the client, and marks nothing here.
 */
const markSelected = (content: string, wanted: string | number): string => {
  const cleared = content.replace(SELECTED_ATTR, '$1');
  OPTION.lastIndex = 0;
  let at = 0;
  for (let match = OPTION.exec(cleared); match; match = OPTION.exec(cleared)) {
    if (typeof wanted === 'number' ? at++ !== wanted : optionValue(match[1], match[2]) !== wanted) continue;
    const open = match[0].slice(0, match[0].indexOf('>'));
    return (
      cleared.slice(0, match.index) +
      open.replace(/\s*\/?$/, '') +
      ' selected>' +
      match[0].slice(match[0].indexOf('>') + 1) +
      cleared.slice(match.index + match[0].length)
    );
  }
  return cleared;
};

/** Resolves every marked `<select>` once its options are in the string — see `SELECT_MARK`. */
const resolveSelects = (markup: string, wanted: ReadonlyArray<string | number>): string => {
  for (let match = MARKED_SELECT.exec(markup); match; match = MARKED_SELECT.exec(markup)) {
    const openTag = match[0].replace(new RegExp(`\\s*${SELECT_MARK}="\\d+"`, 'i'), '');
    const contentStart = match.index + match[0].length;
    const closeAt = markup.toLowerCase().indexOf('</select', contentStart);
    const end = closeAt === -1 ? markup.length : closeAt;
    markup =
      markup.slice(0, match.index) +
      openTag +
      markSelected(markup.slice(contentStart, end), wanted[+match[1]]) +
      markup.slice(end);
  }
  return markup;
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
 * svg/math/noscript/template (`closersOf`). An UNFINISHED tag is dropped, as an assignment's parser drops it at the
 * end of input — served, it swallowed the page's next markup into its attributes. A `<` or `</` that never started a
 * tag is text, written escaped, so the host's own end tag cannot become the rest of it.
 */
const fortify = (markup: string, depth: number): string => {
  const edits: number[] = [];
  const end = scanTag(markup, freshScan(depth), edits);
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
  const end = rest.toLowerCase().indexOf('</' + strip);
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
/**
 * One pattern per attribute name, built once. `new RegExp` per binding was 16% of a 100-row render.
 */
const removalPatterns = new Map<string, RegExp>();
/**
 * The name is **escaped** before it becomes a pattern. A spread's keys are runtime data, and an
 * attribute name may legally contain regular-expression metacharacters — `a|b`, `a.b`, `a*` are all
 * names `setAttribute` accepts — so interpolating one raw built a pattern that matched something
 * else entirely. `a|b` compiled to an alternation and removed text nowhere near the attribute it
 * named.
 */
const escapeForPattern = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const removalPattern = (name: string): RegExp => {
  let pattern = removalPatterns.get(name);
  if (!pattern)
    removalPatterns.set(
      name,
      (pattern = new RegExp(`\\s${escapeForPattern(name)}(=("[^"]*"|'[^']*'|[^\\s>]*))?`, 'i'))
    );
  return pattern;
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
 * Strips one attribute out of an open tag, and the one place that knows how.
 *
 * `foldSpread` had its own copy of this pattern, character for character — so a fix to one was a
 * fix to one. It also rebuilt the pattern on every key of every spread, which is the per-render
 * work `tests/ssr-serializer-work.test.mjs` exists to refuse.
 */
const stripAttribute = (tag: string, name: string): string =>
  /**
   * Almost no tag carries the name twice, and a substring search settles that far faster than a
   * pattern match does. Case-insensitive to match the pattern it guards, which HTML requires.
   */
  tag.toLowerCase().includes(name.toLowerCase()) ? tag.replace(removalPattern(name), '') : tag;

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
  readonly [Symbol.iterator]?: unknown;
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
      if (text && isLiteral((value as Probed).strings)) throw own(new Error(ssrMisuse('ssr-template-in-text', PROSE['ssr-template-in-text']!())));
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
