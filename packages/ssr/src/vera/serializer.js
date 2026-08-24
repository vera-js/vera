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
const SIGIL_TAIL = /([.?@&])([a-zA-Z][\w:-]*)=(["']?)$/;

/** `onClick=${fn}` — the React-shaped event binding, quoted the same three ways. */
const EVENT_TAIL = /on[A-Z][\w:-]*=(["']?)$/;

/**
 * An **unquoted** plain attribute, which is the only one that needs quotes adding. A quoted one
 * carries its quotes in the statics either side, so the value is just escaped text between them.
 */
const PLAIN_ATTRIBUTE_TAIL = /[a-zA-Z][\w:-]*=$/;

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
    if (attribute) {
      /**
       * The name comes off the static and is re-attached at render time, because a nullish value
       * has to take the whole attribute with it — `title=${null}` removes it on the client, exactly
       * as lit does, and this emitted `title=""`. Adoption still succeeded (the statics matched), so
       * the jsdom matrix passed on identity while the two sides disagreed about the attribute; the
       * browser suite adopting through real declarative shadow DOM is what saw it.
       */
      parts.push(part.slice(0, attribute.index).replace(/ $/, ''));
      kinds.push(ATTRIBUTE);
      names.push(attribute[0].slice(0, -1));
      continue;
    }
    parts.push(part);
    kinds.push(TEXT);
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
        out = removeAttribute(out, names[i]);
        if (value) out += ` ${names[i]}=""`;
        break;
      case FORM_PROP:
        out = removeAttribute(out, names[i]);
        if (value != null && value !== false) out += ` ${names[i]}="${escapeHtml(value === true ? '' : value)}"`;
        break;
      case ATTRIBUTE:
        /** Unquoted `attr=${x}`: quoted so spacey values stay one attribute, absent when nullish. */
        out = removeAttribute(out, names[i]);
        if (value != null) out += ` ${names[i]}="${escapeHtml(serializeValue(value, true))}"`;
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
/**
 * Removes an attribute already written into the open tag being built, so the last write wins.
 *
 * An HTML parser keeps the **first** of a duplicate pair; `setAttribute` on the client overwrites,
 * so the **last** wins there. `<b title="a" title=${x}>` therefore showed `a` on a server-rendered
 * page and `b` in the browser — the same disagreement `foldSpread` was written to fix for spreads,
 * which is where this logic came from. It applies to anything that writes a name into the tag.
 */
const removeAttribute = (out, name) => {
  const tagStart = out.lastIndexOf('<');
  if (tagStart === -1) return out;
  const tag = out
    .slice(tagStart)
    .replace(new RegExp(`\\s${name}(=("[^"]*"|'[^']*'|[^\\s>]*))?`, 'i'), '');
  return out.slice(0, tagStart) + tag;
};

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

  /**
   * The element-position slot already carries the separating space, so the first addition drops its
   * own. When a spread contributes nothing — every key nullish, or all of them client concerns —
   * that space is left dangling before the `>`, which the parser ignores and which is still a byte
   * in every response and untidy in a view-source.
   */
  return out.slice(0, tagStart) + (added ? tag + added.slice(1) : tag.replace(/ $/, ''));
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
     */
    if (value._$attrs$) return '';

    /**
     * An iterable renders its entries, exactly as the client's child position does — a `Set` or a
     * `Map` reaching a template is not obviously deliberate, but the two sides have to agree about
     * it or hydration is discarded.
     */
    if (typeof value[Symbol.iterator] === 'function') {
      return [...value].map((entry) => serializeValue(entry, raw)).join('');
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
  return raw ? String(value) : escapeHtml(value);
};
