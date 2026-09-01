/**
 * The properties that exist only on *some* elements — `input.disabled`, `a.href`, `td.colSpan` —
 * and the content attributes they reflect.
 *
 * **Why this file exists.** The server DOM had one element type for every tag, carrying only the
 * members every element shares (`id`, `title`, `hidden`, `tabIndex`, the enumerated states). Nothing
 * element-specific existed at all, so `button.disabled = true` stored a plain JavaScript property,
 * wrote no attribute, and **rendered a button that was not disabled** — while reading the property
 * back said `true`, so the code looked right. Setting `input.value`, `input.checked` and
 * `option.selected` failed the same way, and reading any of them before writing gave `undefined`
 * where a browser gives `''` or `false`, so `input.value.trim()` threw on the server and worked in
 * the client.
 *
 * Nothing failed loudly, which is what made it bad: a control that must not be interactive shipped
 * interactive, and stayed that way until the bundle landed and the client set the property for real.
 *
 * **The table is measured, not remembered.** `scripts/measure-element-reflections.mjs` drives
 * Chromium, Firefox and WebKit: for every property on every element-specific interface it reads the
 * value with the attribute absent, assigns a probe, and looks at which attribute appeared and what
 * reading it back gives. A property is only recorded when all three engines agree on every one of
 * those cells, and when reading the attribute back yields exactly what was written — which is what
 * drops `input.width` (laid out, so it reads `0`), `meter.value` (clamped to its max) and
 * `form.action` (resolved against a document URL this DOM does not have). The reasons are listed at
 * the bottom of this file rather than left to be rediscovered.
 *
 * This is the same discipline the generic table in `nodes.js` was built with, and for the same
 * reason: every value there that was written from memory turned out to be wrong. `tabIndex` had no
 * default, so every element claimed to be in the tab order; `draggable` and `spellcheck` were given
 * one shared default when they do not share one.
 *
 * **Enumerated states follow the majority where the engines differ**, as `popover: 'hint'` already
 * does — an enumerated state cannot reach the markup, because the attribute is stored verbatim, so
 * the cost of being in the minority is a property read and nothing else. The six that needed it are
 * named at the bottom.
 *
 * `tests/browser/element-reflections.test.js` re-measures in a real engine and fails if this table
 * and the browser have drifted apart.
 */

/**
 * `[kind, attribute, ...]`, where kind is one of:
 *
 * - `presence` — a boolean; the attribute's presence is the value. A third entry is the answer when
 *   the attribute is absent, for the one case where that is not `false` (`script.async`).
 * - `string` — the attribute's text, or `''` when it is absent.
 * - `number` — the attribute parsed as an integer, or the third entry when absent or unparseable.
 * - `enum` — `[missing, invalid, states]`: a limited set of states, answered canonically, with its
 *   own answer for absent and for anything outside the set.
 *
 * **An enumerated *content* attribute is not an enumerated *IDL* attribute**, and three rows here
 * confused the two. `area.shape`, `ol.type` and `textarea.wrap` all name a limited set of keywords
 * that affect rendering — but their IDL is a plain `attribute DOMString`, so the property echoes
 * whatever was written. They were listed as `enum` with an invalid-value answer of
 * `"zzz-not-a-state"`, which is not a string any engine produces: it is the **probe value** whoever
 * wrote those rows used to discover an invalid-value default, recorded as though it were the answer.
 *
 * So `area.shape = 'probe'` answered `"zzz-not-a-state"` and `shape = 'CIRCLE'` answered `"circle"`,
 * where every engine echoes the input. The header above says every enumerated state here "was
 * measured on three engines instead of read off a spec" — these three were not; a measurement would
 * have shown the echo. Reclassified as `string`, which is what the IDL says and what a real DOM does.
 */
export const ELEMENT_REFLECTIONS = {
  a: {
    charset: ["string","charset"],
    coords: ["string","coords"],
    download: ["string","download"],
    href: ["string","href"],
    hreflang: ["string","hreflang"],
    name: ["string","name"],
    ping: ["string","ping"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    rel: ["string","rel"],
    rev: ["string","rev"],
    shape: ["string","shape"],
    target: ["string","target"],
    type: ["string","type"],
  },
  area: {
    alt: ["string","alt"],
    coords: ["string","coords"],
    download: ["string","download"],
    href: ["string","href"],
    noHref: ["presence","nohref"],
    ping: ["string","ping"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    rel: ["string","rel"],
    shape: ["string","shape"],
    target: ["string","target"],
  },
  base: {
    target: ["string","target"],
  },
  blockquote: {
    cite: ["string","cite"],
  },
  br: {
    clear: ["string","clear"],
  },
  button: {
    disabled: ["presence","disabled"],
    formEnctype: ["enum","formenctype","","application/x-www-form-urlencoded",["application/x-www-form-urlencoded","multipart/form-data","text/plain"]],
    formMethod: ["enum","formmethod","","get",["get","post","dialog"]],
    formNoValidate: ["presence","formnovalidate"],
    formTarget: ["string","formtarget"],
    name: ["string","name"],
    popoverTargetAction: ["enum","popovertargetaction","toggle","toggle",["toggle","show","hide"]],
    type: ["enum","type","submit","submit",["submit","reset","button"]],
    value: ["string","value"],
  },
  canvas: {
    height: ["number","height",150],
    width: ["number","width",300],
  },
  caption: {
    align: ["string","align"],
  },
  col: {
    align: ["string","align"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    span: ["number","span",1],
    vAlign: ["string","valign"],
    width: ["string","width"],
  },
  colgroup: {
    align: ["string","align"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    span: ["number","span",1],
    vAlign: ["string","valign"],
    width: ["string","width"],
  },
  data: {
    value: ["string","value"],
  },
  del: {
    cite: ["string","cite"],
    dateTime: ["string","datetime"],
  },
  details: {
    name: ["string","name"],
    open: ["presence","open"],
  },
  dialog: {
    closedBy: ["enum","closedby","none","none",["any","closerequest","none"]],
    open: ["presence","open"],
  },
  div: {
    align: ["string","align"],
  },
  dl: {
    compact: ["presence","compact"],
  },
  embed: {
    align: ["string","align"],
    height: ["string","height"],
    name: ["string","name"],
    src: ["string","src"],
    type: ["string","type"],
    width: ["string","width"],
  },
  fieldset: {
    disabled: ["presence","disabled"],
    name: ["string","name"],
  },
  form: {
    acceptCharset: ["string","accept-charset"],
    autocomplete: ["enum","autocomplete","on","on",["on","off"]],
    encoding: ["enum","enctype","application/x-www-form-urlencoded","application/x-www-form-urlencoded",["application/x-www-form-urlencoded","multipart/form-data","text/plain"]],
    enctype: ["enum","enctype","application/x-www-form-urlencoded","application/x-www-form-urlencoded",["application/x-www-form-urlencoded","multipart/form-data","text/plain"]],
    method: ["enum","method","get","get",["get","post","dialog"]],
    name: ["string","name"],
    noValidate: ["presence","novalidate"],
    rel: ["string","rel"],
    target: ["string","target"],
  },
  h1: {
    align: ["string","align"],
  },
  h2: {
    align: ["string","align"],
  },
  h3: {
    align: ["string","align"],
  },
  h4: {
    align: ["string","align"],
  },
  h5: {
    align: ["string","align"],
  },
  h6: {
    align: ["string","align"],
  },
  hr: {
    align: ["string","align"],
    color: ["string","color"],
    noShade: ["presence","noshade"],
    size: ["string","size"],
    width: ["string","width"],
  },
  iframe: {
    align: ["string","align"],
    allow: ["string","allow"],
    allowFullscreen: ["presence","allowfullscreen"],
    frameBorder: ["string","frameborder"],
    height: ["string","height"],
    loading: ["enum","loading","eager","eager",["eager","lazy"]],
    longDesc: ["string","longdesc"],
    marginHeight: ["string","marginheight"],
    marginWidth: ["string","marginwidth"],
    name: ["string","name"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    scrolling: ["string","scrolling"],
    src: ["string","src"],
    srcdoc: ["string","srcdoc"],
    width: ["string","width"],
  },
  img: {
    align: ["string","align"],
    alt: ["string","alt"],
    border: ["string","border"],
    decoding: ["enum","decoding","auto","auto",["sync","async","auto"]],
    fetchPriority: ["enum","fetchpriority","auto","auto",["high","low","auto"]],
    height: ["number","height",0],
    hspace: ["number","hspace",0],
    isMap: ["presence","ismap"],
    loading: ["enum","loading","eager","eager",["eager","lazy"]],
    longDesc: ["string","longdesc"],
    lowsrc: ["string","lowsrc"],
    name: ["string","name"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    sizes: ["string","sizes"],
    src: ["string","src"],
    srcset: ["string","srcset"],
    useMap: ["string","usemap"],
    vspace: ["number","vspace",0],
    width: ["number","width",0],
  },
  input: {
    accept: ["string","accept"],
    align: ["string","align"],
    alt: ["string","alt"],
    autocomplete: ["enum","autocomplete","","",["on","off"]],
    defaultChecked: ["presence","checked"],
    defaultValue: ["string","value"],
    dirName: ["string","dirname"],
    disabled: ["presence","disabled"],
    formEnctype: ["enum","formenctype","","application/x-www-form-urlencoded",["application/x-www-form-urlencoded","multipart/form-data","text/plain"]],
    formMethod: ["enum","formmethod","","get",["get","post","dialog"]],
    formNoValidate: ["presence","formnovalidate"],
    formTarget: ["string","formtarget"],
    max: ["string","max"],
    maxLength: ["number","maxlength",-1],
    min: ["string","min"],
    minLength: ["number","minlength",-1],
    multiple: ["presence","multiple"],
    name: ["string","name"],
    pattern: ["string","pattern"],
    placeholder: ["string","placeholder"],
    popoverTargetAction: ["enum","popovertargetaction","toggle","toggle",["toggle","show","hide"]],
    readOnly: ["presence","readonly"],
    required: ["presence","required"],
    size: ["number","size",20],
    src: ["string","src"],
    step: ["string","step"],
    type: ["enum","type","text","text",["text","password","checkbox","radio","submit","reset","button","hidden","image","file","number","range","date","month","week","time","datetime-local","email","url","search","tel","color"]],
    useMap: ["string","usemap"],
    webkitdirectory: ["presence","webkitdirectory"],
  },
  ins: {
    cite: ["string","cite"],
    dateTime: ["string","datetime"],
  },
  label: {
    htmlFor: ["string","for"],
  },
  legend: {
    align: ["string","align"],
  },
  li: {
    type: ["string","type"],
    value: ["number","value",0],
  },
  link: {
    as: ["enum","as","","",["fetch","font","image","script","style","track","audio","video"]],
    charset: ["string","charset"],
    disabled: ["presence","disabled"],
    fetchPriority: ["enum","fetchpriority","auto","auto",["high","low","auto"]],
    href: ["string","href"],
    hreflang: ["string","hreflang"],
    imageSizes: ["string","imagesizes"],
    imageSrcset: ["string","imagesrcset"],
    integrity: ["string","integrity"],
    media: ["string","media"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    rel: ["string","rel"],
    rev: ["string","rev"],
    target: ["string","target"],
    type: ["string","type"],
  },
  map: {
    name: ["string","name"],
  },
  menu: {
    compact: ["presence","compact"],
  },
  meta: {
    content: ["string","content"],
    httpEquiv: ["string","http-equiv"],
    media: ["string","media"],
    name: ["string","name"],
    scheme: ["string","scheme"],
  },
  meter: {
    max: ["number","max",1],
    min: ["number","min",0],
  },
  object: {
    align: ["string","align"],
    archive: ["string","archive"],
    border: ["string","border"],
    code: ["string","code"],
    codeBase: ["string","codebase"],
    codeType: ["string","codetype"],
    data: ["string","data"],
    declare: ["presence","declare"],
    height: ["string","height"],
    hspace: ["number","hspace",0],
    name: ["string","name"],
    standby: ["string","standby"],
    type: ["string","type"],
    useMap: ["string","usemap"],
    vspace: ["number","vspace",0],
    width: ["string","width"],
  },
  ol: {
    compact: ["presence","compact"],
    reversed: ["presence","reversed"],
    start: ["number","start",1],
    type: ["string","type"],
  },
  optgroup: {
    disabled: ["presence","disabled"],
    label: ["string","label"],
  },
  option: {
    defaultSelected: ["presence","selected"],
    disabled: ["presence","disabled"],
    label: ["string","label"],
    value: ["string","value"],
  },
  output: {
    name: ["string","name"],
  },
  p: {
    align: ["string","align"],
  },
  param: {
    name: ["string","name"],
    type: ["string","type"],
    value: ["string","value"],
    valueType: ["string","valuetype"],
  },
  pre: {
    width: ["number","width",0],
  },
  progress: {
    max: ["number","max",1],
  },
  q: {
    cite: ["string","cite"],
  },
  script: {
    async: ["presence","async",true],
    charset: ["string","charset"],
    defer: ["presence","defer"],
    event: ["string","event"],
    fetchPriority: ["enum","fetchpriority","auto","auto",["high","low","auto"]],
    htmlFor: ["string","for"],
    integrity: ["string","integrity"],
    noModule: ["presence","nomodule"],
    referrerPolicy: ["enum","referrerpolicy","","",["","no-referrer","no-referrer-when-downgrade","same-origin","origin","strict-origin","origin-when-cross-origin","strict-origin-when-cross-origin","unsafe-url"]],
    src: ["string","src"],
    type: ["string","type"],
  },
  select: {
    autocomplete: ["enum","autocomplete","","",["on","off"]],
    disabled: ["presence","disabled"],
    multiple: ["presence","multiple"],
    name: ["string","name"],
    required: ["presence","required"],
    size: ["number","size",0],
  },
  slot: {
    name: ["string","name"],
  },
  source: {
    height: ["number","height",0],
    media: ["string","media"],
    sizes: ["string","sizes"],
    src: ["string","src"],
    srcset: ["string","srcset"],
    type: ["string","type"],
    width: ["number","width",0],
  },
  style: {
    media: ["string","media"],
    type: ["string","type"],
  },
  table: {
    align: ["string","align"],
    bgColor: ["string","bgcolor"],
    border: ["string","border"],
    cellPadding: ["string","cellpadding"],
    cellSpacing: ["string","cellspacing"],
    frame: ["string","frame"],
    rules: ["string","rules"],
    summary: ["string","summary"],
    width: ["string","width"],
  },
  tbody: {
    align: ["string","align"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    vAlign: ["string","valign"],
  },
  td: {
    abbr: ["string","abbr"],
    align: ["string","align"],
    axis: ["string","axis"],
    bgColor: ["string","bgcolor"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    colSpan: ["number","colspan",1],
    headers: ["string","headers"],
    height: ["string","height"],
    noWrap: ["presence","nowrap"],
    rowSpan: ["number","rowspan",1],
    scope: ["enum","scope","","",["row","col","rowgroup","colgroup"]],
    vAlign: ["string","valign"],
    width: ["string","width"],
  },
  template: {
    /**
     * Measured identical on Chromium, Firefox and WebKit: absent and invalid both answer `''`, and a
     * valid keyword is answered lowercased (`'OPEN'` → `'open'`). It is here rather than excluded
     * because this package **emits** `<template shadowrootmode>` for declarative shadow DOM, so a
     * component reading it back on the server is asking about markup this renderer wrote.
     */
    shadowRootMode: ["enum","shadowrootmode","","",["open","closed"]],
    shadowRootClonable: ["presence","shadowrootclonable"],
    shadowRootDelegatesFocus: ["presence","shadowrootdelegatesfocus"],
    shadowRootSerializable: ["presence","shadowrootserializable"],
  },
  textarea: {
    autocomplete: ["enum","autocomplete","","",["on","off"]],
    cols: ["number","cols",20],
    dirName: ["string","dirname"],
    disabled: ["presence","disabled"],
    maxLength: ["number","maxlength",-1],
    minLength: ["number","minlength",-1],
    name: ["string","name"],
    placeholder: ["string","placeholder"],
    readOnly: ["presence","readonly"],
    required: ["presence","required"],
    rows: ["number","rows",2],
    wrap: ["string","wrap"],
  },
  tfoot: {
    align: ["string","align"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    vAlign: ["string","valign"],
  },
  th: {
    abbr: ["string","abbr"],
    align: ["string","align"],
    axis: ["string","axis"],
    bgColor: ["string","bgcolor"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    colSpan: ["number","colspan",1],
    headers: ["string","headers"],
    height: ["string","height"],
    noWrap: ["presence","nowrap"],
    rowSpan: ["number","rowspan",1],
    scope: ["enum","scope","","",["row","col","rowgroup","colgroup"]],
    vAlign: ["string","valign"],
    width: ["string","width"],
  },
  thead: {
    align: ["string","align"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    vAlign: ["string","valign"],
  },
  time: {
    dateTime: ["string","datetime"],
  },
  tr: {
    align: ["string","align"],
    bgColor: ["string","bgcolor"],
    ch: ["string","char"],
    chOff: ["string","charoff"],
    vAlign: ["string","valign"],
  },
  track: {
    default: ["presence","default"],
    kind: ["enum","kind","subtitles","metadata",["subtitles","captions","descriptions","chapters","metadata"]],
    label: ["string","label"],
    src: ["string","src"],
    srclang: ["string","srclang"],
  },
  ul: {
    compact: ["presence","compact"],
    type: ["string","type"],
  },
  video: {
    disablePictureInPicture: ["presence","disablepictureinpicture"],
    height: ["number","height",0],
    poster: ["string","poster"],
    width: ["number","width",0],
  },

};

/**
 * The four properties a browser deliberately does **not** reflect, and which this DOM does anyway.
 *
 * `input.value`, `input.checked`, `option.selected` and `textarea.value` carry a "dirty value" in
 * the platform: assigning one changes what the control shows without touching the markup, so that a
 * reload restores what the author wrote. Copying that exactly would be wrong here for a reason that
 * has nothing to do with fidelity — **on a server the markup is the whole output**, so an assignment
 * the markup cannot carry is an assignment that is silently lost.
 *
 * `@verajs/ssr` had already made this call for template bindings: `serializer.js` mirrors
 * `.value`/`.checked`/`.selected` to attributes on form elements "so hydration can read form state
 * back out of the markup". Doing it here too is that same rule applied to the other way of writing
 * the same thing — a property assignment in `connectedCallback` now behaves like the binding, rather
 * than being the one path that quietly drops the value.
 *
 * The reads follow the platform exactly: absent means `''` or `false`, `textarea.value` is its
 * content, and `select.value` is the value of the option that is selected.
 */
/**
 * **`[LegacyNullToEmptyString]`** — a handful of IDL string attributes store `''` for `null` rather
 * than the word `"null"`, and `input.value`, `textarea.value` and `innerHTML` are three of them.
 *
 * This is the same defect the README already records as found and fixed: *"`textContent = null`
 * writing the word 'null'"*. It was fixed where it was found rather than for the rule, so the other
 * members of the class stayed wrong — the exact pattern `tests/ssr-spread-equivalence.test.mjs`
 * opens by describing.
 *
 * It matters because `element.value = maybeNull` in a component is ordinary code. The server wrote
 * `value="null"` where the client stores `''`, so the control showed the word "null" until hydration
 * replaced it — and the surface comparison could not catch it, because that check compares a member's
 * *shape* rather than its answer to a particular input, which the README says in as many words.
 *
 * `undefined` is **not** included: the platform stringifies it to `"undefined"`, and only `null` is
 * special-cased by the extended attribute.
 */
const legacyNullToEmptyString = (value) => (value === null ? '' : `${value}`);

const FORM_STATE = {
  input: {
    value: {
      get() {
        return this.getAttribute('value') ?? '';
      },
      set(value) {
        this.setAttribute('value', legacyNullToEmptyString(value));
      },
    },
    checked: {
      get() {
        return this.hasAttribute('checked');
      },
      set(value) {
        if (value) this.setAttribute('checked', '');
        else this.removeAttribute('checked');
      },
    },
  },
  textarea: {
    /** A `<textarea>` has no `value` attribute — its value *is* its content, in markup and here. */
    value: {
      get() {
        return this.textContent;
      },
      set(value) {
        this.textContent = legacyNullToEmptyString(value);
      },
    },
  },
  option: {
    selected: {
      get() {
        return this.hasAttribute('selected');
      },
      set(value) {
        if (value) this.setAttribute('selected', '');
        else this.removeAttribute('selected');
      },
    },
  },
  select: {
    /**
     * A `<select>` has no `value` content attribute at all: its value is whichever option is
     * selected, so reading walks the options and writing selects one. A value matching no option
     * cannot be served — the same limitation the README records, since there is no markup for it.
     */
    value: {
      get() {
        const options = this.querySelectorAll('option');
        const chosen = options.find((option) => option.hasAttribute('selected')) ?? options[0];
        return chosen === undefined ? '' : (chosen.getAttribute('value') ?? chosen.textContent);
      },
      set(value) {
        const wanted = `${value}`;
        for (const option of this.querySelectorAll('option')) {
          const own = option.getAttribute('value') ?? option.textContent;
          if (own === wanted) option.setAttribute('selected', '');
          else option.removeAttribute('selected');
        }
      },
    },
  },
};

/** Per-tag constructors, built once and shared by every element of that tag. */
const constructors = new Map();

const define = (proto, property, accessors) =>
  Object.defineProperty(proto, property, { ...accessors, configurable: true });

/**
 * The constructor an element of this tag should be built with: `Base` when the tag has no interface
 * of its own, otherwise a subclass carrying its properties.
 *
 * A class per tag rather than accessors on the shared prototype, because `'disabled' in paragraph`
 * must stay `false` — an element answering for members its interface does not have is the same lie
 * as one missing the members it does.
 *
 * A subclass rather than `Object.setPrototypeOf` on a finished element, which was the first shape
 * this took. Measured over 20,000 elements, three runs each: setting the prototype afterwards cost
 * **~745 ns** per `<input>` (and once wandered to 1004) against ~400 ns for a `<div>`; building it
 * as its own class costs **~458 ns**. The `<div>` figure is unchanged either way, which is the part
 * worth recording — the penalty was local to the element whose prototype was mutated, not spread
 * across the shared path, so the first draft of this comment blamed a deopt it had not measured.
 */
export const interfaceFor = (tag, Base) => {
  const table = ELEMENT_REFLECTIONS[tag];
  const state = FORM_STATE[tag];
  if (table === undefined && state === undefined) return Base;
  const cached = constructors.get(tag);
  if (cached !== undefined) return cached;

  const Element = class extends Base {};
  const proto = Element.prototype;
  for (const [property, entry] of Object.entries(table ?? {})) {
    const [kind, attribute] = entry;
    if (kind === 'presence') {
      const absent = entry[2] ?? false;
      define(proto, property, {
        get() {
          return this.hasAttribute(attribute) ? true : absent;
        },
        set(value) {
          if (value) this.setAttribute(attribute, '');
          else this.removeAttribute(attribute);
        },
      });
    } else if (kind === 'string') {
      define(proto, property, {
        get() {
          return this.getAttribute(attribute) ?? '';
        },
        set(value) {
          this.setAttribute(attribute, `${value}`);
        },
      });
    } else if (kind === 'number') {
      const absent = entry[2];
      define(proto, property, {
        get() {
          const raw = this.getAttribute(attribute);
          if (raw === null) return absent;
          /** A browser answers the default for anything it cannot parse, not `NaN`. */
          const parsed = Number.parseInt(raw, 10);
          return Number.isNaN(parsed) ? absent : parsed;
        },
        /**
         * **A numeric property converts before it writes, and this wrote the value verbatim.**
         *
         * The platform applies the WebIDL conversion for the property's type at *assignment*, and
         * writes the **converted** number to the attribute — not what the caller passed. Measured in
         * Chromium across all 31 `number` reflections here, and every one shares this part:
         *
         * | written | attribute a browser writes | this wrote |
         * | --- | --- | --- |
         * | `3.9` | `"3"` | `"3.9"` |
         * | `'probe'` | `"0"` | `"probe"` |
         * | `''` | `"0"` | `""` |
         *
         * The reachable case is the first. `element.width = someComputedValue` is ordinary code, and
         * a fractional result made the server write `width="3.9"` where the client writes `width="3"`
         * — a hydration mismatch nobody did anything wrong to earn.
         *
         * **What this deliberately does not do** is the per-property part. A *negative* value is
         * clamped to 0 by eleven of these properties, to 1 by six, refused outright by four
         * (`maxLength`, `minLength`), allowed by two, and replaced with an element default by
         * `canvas.width`/`height` and `input.size`. Three more (`meter.min`/`max`, `progress.max`) are
         * `double` rather than `unsigned long` and do not truncate at all.
         *
         * Encoding that means thirty-one hand-classified rows in this table — which is how
         * `area.shape`, `ol.type` and `textarea.wrap` came to answer with the probe value used to
         * measure them. A negative width is already a caller's mistake; a fractional one is not. The
         * measured table is in `internal/docs/audits/2026-08-26-gauntlet.md` if that trade is ever
         * worth revisiting.
         */
        set(value) {
          const number = Number(value);
          this.setAttribute(attribute, `${Number.isFinite(number) ? Math.trunc(number) : 0}`);
        },
      });
    } else {
      const [, , missing, invalid, states] = entry;
      define(proto, property, {
        get() {
          const raw = this.getAttribute(attribute);
          if (raw === null) return missing;
          /** Enumerated attributes are ASCII case-insensitive and the getter answers canonically. */
          const state = raw.toLowerCase();
          return states.includes(state) ? state : invalid;
        },
        /** The setter writes what it is given; only the getter maps to a state. */
        set(value) {
          this.setAttribute(attribute, `${value}`);
        },
      });
    }
  }
  for (const [property, accessors] of Object.entries(state ?? {})) define(proto, property, accessors);
  constructors.set(tag, Element);
  return Element;
};

/**
 * **What the engines expose that this table deliberately does not**, so the next reader does not
 * have to measure it again to find out why:
 *
 * - `base.href`, `form.action`, `button.formAction`, `input.formAction` — resolved against the
 *   document's URL, which a server render does not have. Answering the raw attribute would be a
 *   different value from the browser's; answering an absolute URL would require inventing an origin.
 * - `input.width`, `input.height` — read back from layout, so a browser answers `0` for anything it
 *   has not laid out, whatever the attribute says.
 * - `meter.value`, `meter.low`, `meter.high`, `meter.optimum`, `progress.value` — clamped against
 *   each other and against `max`, so the property is not the attribute.
 * - `button.command` — canonicalised to `''` for anything outside its state list, which is not yet
 *   stable across engines.
 * - Vendor extensions present in one engine only: `a.attributionSourceId` and its two neighbours,
 *   `area.hreflang`, `area.type`, `canvas.mozOpaque`, `iframe.csp`, `iframe.credentialless`,
 *   `iframe.allowPaymentRequest`, `input.incremental`, `input.alpha`, `input.colorSpace`,
 *   `input.switch`, `video.playsInline`, `video.autoPictureInPicture`,
 *   `video.webkitWirelessVideoPlaybackDisabled`.
 *
 * And the six where the engines disagree and the majority was taken, none of which can reach the
 * markup: `input.type` (Chromium accepts `month` and `week`; the others do not), `link.as` (three
 * different state lists), `img.loading` and `iframe.loading` (absent reads `auto` in Chromium and
 * `eager` elsewhere), `button.popoverTargetAction` and `input.popoverTargetAction` (absent reads
 * `''` in Firefox and `toggle` elsewhere).
 */
