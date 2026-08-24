import { escapeHtml } from './shim.js';

/**
 * The vera-native template serializer: flattens core's `html` template objects to markup with
 * the renderer's sigil semantics applied server-side.
 *
 *   `?bool=${x}`   -> `bool=""` when truthy, nothing when falsy
 *   `.prop=${x}`   -> mirrored to an attribute for form state (value/checked/selected), else dropped
 *   `@event=${fn}` -> dropped (behavior is the client's job)
 *   `&ref=${r}`    -> dropped
 *   `attr=${x}`    -> quoted, escaped
 *   text `${x}`    -> escaped; nested templates and arrays flatten; null/undefined/false vanish
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
 * A sigil binding, however the author quoted it — `"`, `'`, or not at all.
 *
 * Only the double-quoted and unquoted forms were recognised, and the client supports all three
 * because it hands the markup to the platform's parser. So `<input .value='${v}' />` set a property
 * in the browser and emitted a literal attribute named `.value` on the server; `?hidden='${true}'`
 * hid the element on one side and printed `?hidden='true'` on the other. Visible difference on a
 * static page, guaranteed mismatch on a hydrated one.
 */
const SIGIL_TAIL = /([.?@&])([a-zA-Z][\w-]*)=(["']?)$/;

/** `onClick=${fn}` — the React-shaped event binding, quoted the same three ways. */
const EVENT_TAIL = /on[A-Z][\w-]*=(["']?)$/;

/**
 * An **unquoted** plain attribute, which is the only one that needs quotes adding. A quoted one
 * carries its quotes in the statics either side, so the value is just escaped text between them.
 */
const PLAIN_ATTRIBUTE_TAIL = /[a-zA-Z][\w-]*=$/;

/** Slot kinds: text, boolean, form-prop, dropped binding, plain attribute. */
const TEXT = 0;
const BOOLEAN = 1;
const FORM_PROP = 2;
const DROPPED = 3;
const ATTRIBUTE = 4;

/** strings identity -> { parts, kinds, names } — computed once per call site, ever. */
const plans = new WeakMap();

/**
 * Whether the text so far leaves us inside an open tag — the question every sigil test below
 * silently assumed the answer to.
 *
 * Without it a slot was classified by what the static happened to *end* with, wherever it sat.
 * `html\`<p>total=${n}</p>\`` is text, but ends in `total=`, so it was written as an unquoted
 * attribute and the server produced `<p>total="5"</p>` against the client's `<p>total=5</p>` — a
 * visible difference on a static page and a discarded hydration on a live one. The client never had
 * the bug because it hands the markup to the platform's parser, which knows where it is.
 *
 * A raw `<` in text (`a < b`) reads as an open tag here, as it does to a lenient HTML parser in
 * some positions; escape it, as HTML has always asked.
 */
const closesTag = (text, inTag) => {
  const open = text.lastIndexOf('<');
  const close = text.lastIndexOf('>');
  if (open > close) return true;
  if (close > open) return false;
  return inTag;
};

const compile = (strings) => {
  const parts = [];
  const kinds = [];
  const names = [];
  /** The quote character a binding opened with, to be stripped off the front of the next static. */
  let openQuote = '';
  let inTag = false;

  for (let i = 0; i < strings.length - 1; i++) {
    let part = strings[i];
    if (openQuote && part.startsWith(openQuote)) part = part.slice(1);
    inTag = closesTag(part, inTag);

    const sigil = inTag && SIGIL_TAIL.exec(part);
    if (sigil) {
      /** The space that preceded the binding goes with it, so dropped bindings leave no residue. */
      parts.push(part.slice(0, sigil.index).replace(/ $/, ''));
      openQuote = sigil[3];
      const kind = sigil[1];
      if (kind === '?') {
        kinds.push(BOOLEAN);
      } else if (kind === '.' && FORM_ATTRIBUTES.includes(sigil[2])) {
        kinds.push(FORM_PROP);
      } else {
        kinds.push(DROPPED);
      }
      names.push(sigil[2]);
      continue;
    }

    openQuote = '';

    const event = inTag && EVENT_TAIL.exec(part);
    if (event) {
      /** A client concern, dropped like `@` — and it may be quoted, so remember which. */
      parts.push(part.slice(0, event.index).replace(/ $/, ''));
      openQuote = event[1];
      kinds.push(DROPPED);
      names.push('');
      continue;
    }

    const attribute = inTag && PLAIN_ATTRIBUTE_TAIL.exec(part);
    parts.push(part);
    kinds.push(attribute ? ATTRIBUTE : TEXT);
    names.push('');
  }

  let last = strings[strings.length - 1];
  if (openQuote && last.startsWith(openQuote)) last = last.slice(1);
  parts.push(last);

  const plan = { parts, kinds, names };
  plans.set(strings, plan);
  return plan;
};

export const serializeTemplate = (template) => {
  const { strings, values } = template;
  const { parts, kinds, names } = plans.get(strings) ?? compile(strings);
  let out = '';

  for (let i = 0; i < kinds.length; i++) {
    out += parts[i];
    const value = values[i];
    switch (kinds[i]) {
      case TEXT:
        /** A spread rewrites the open tag it sits in, so it is folded rather than appended. */
        if (value !== null && typeof value === 'object' && value._$attrs$) out = foldSpread(out, value._$attrs$());
        else out += serializeValue(value);
        break;
      case BOOLEAN:
        if (value) out += ` ${names[i]}=""`;
        break;
      case FORM_PROP:
        if (value != null && value !== false) out += ` ${names[i]}="${escapeHtml(value === true ? '' : value)}"`;
        break;
      case ATTRIBUTE:
        /** Unquoted `attr=${x}`: quote it so spacey values stay one attribute. */
        out += '"' + escapeHtml(serializeValue(value, true)) + '"';
        break;
      /** DROPPED: '@' and '&' and non-form '.': nothing — client concerns. */
    }
  }
  return out + parts[kinds.length];
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
const foldSpread = (out, entries) => {
  const tagStart = out.lastIndexOf('<');
  let tag = out.slice(tagStart);
  let added = '';

  for (const [kind, name, value] of entries) {
    const serializes = kind === 'a' || kind === 'b' || (kind === 'p' && FORM_ATTRIBUTES.includes(name));
    if (!serializes) continue;

    /** Quoted, single-quoted, unquoted, or valueless — whatever the template author wrote. */
    tag = tag.replace(new RegExp(`\\s${name}(=("[^"]*"|'[^']*'|[^\\s>]*))?`, 'i'), '');

    if (kind === 'b') {
      if (value) added += ` ${name}=""`;
    } else if (value != null && value !== false) {
      added += ` ${name}="${escapeHtml(kind === 'p' && value === true ? '' : serializeValue(value, true))}"`;
    }
  }

  /** The element-position slot already carries the separating space. */
  return out.slice(0, tagStart) + tag + (added ? added.slice(1) : '');
};

const serializeValue = (value, raw = false) => {
  /**
   * Only `null` and `undefined` are empty, exactly as on the client — `false` and `0` render.
   * `false` used to serialize as empty here, which made `${cond && 'x'}` emit nothing on the server
   * and the text `false` in the browser: a silent content difference on a static page, and a full
   * re-render on a hydrated one.
   */
  if (value == null) return '';
  if (Array.isArray(value)) return value.map((entry) => serializeValue(entry, raw)).join('');
  if (typeof value === 'function') return '';
  if (typeof value === 'object') {
    /** Template-shaped (core's html, by shape) recurses. */
    if (value.strings) return serializeTemplate(value);
    /**
     * A spread (`@verajs/renderer/spread`) at element position. It hands back resolved bindings and this
     * decides what reaches markup: attributes and truthy booleans do, form properties do because
     * hydration reads them back, and events and other properties are client state. Escaping happens
     * here and only here — principle #8 puts it at the render boundary, not at the source.
     *
     * Anything else at element position is a ref, which is a client concern.
     */
    return '';
  }
  return raw ? String(value) : escapeHtml(value);
};
