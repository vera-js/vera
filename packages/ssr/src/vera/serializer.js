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

const SIGIL_TAIL = /([.?@&])([a-zA-Z][\w-]*)=("?)$/;
const PLAIN_ATTRIBUTE_TAIL = /[a-zA-Z][\w-]*=$/;

/** Slot kinds: text, boolean, form-prop, dropped binding, plain attribute. */
const TEXT = 0;
const BOOLEAN = 1;
const FORM_PROP = 2;
const DROPPED = 3;
const ATTRIBUTE = 4;

/** strings identity -> { parts, kinds, names } — computed once per call site, ever. */
const plans = new WeakMap();

const compile = (strings) => {
  const parts = [];
  const kinds = [];
  const names = [];
  let skipQuote = false;

  for (let i = 0; i < strings.length - 1; i++) {
    let part = strings[i];
    if (skipQuote) part = part.startsWith('"') ? part.slice(1) : part;

    const sigil = SIGIL_TAIL.exec(part);
    if (sigil) {
      /** The space that preceded the binding goes with it, so dropped bindings leave no residue. */
      parts.push(part.slice(0, sigil.index).replace(/ $/, ''));
      skipQuote = sigil[3] === '"';
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

    skipQuote = false;
    const attribute = PLAIN_ATTRIBUTE_TAIL.exec(part);
    if (attribute && /^on[A-Z]/.test(attribute[0])) {
      /** `onClick=${fn}` — the React-shaped event binding; a client concern, dropped like `@`. */
      parts.push(part.slice(0, attribute.index).replace(/ $/, ''));
      kinds.push(DROPPED);
      names.push('');
      continue;
    }
    parts.push(part);
    kinds.push(attribute ? ATTRIBUTE : TEXT);
    names.push('');
  }

  let last = strings[strings.length - 1];
  if (skipQuote) last = last.startsWith('"') ? last.slice(1) : last;
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
        out += serializeValue(value);
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

const serializeValue = (value, raw = false) => {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map((entry) => serializeValue(entry, raw)).join('');
  if (typeof value === 'function') return '';
  if (typeof value === 'object') {
    /** Template-shaped (core's html, by shape) recurses; anything else (refs…) is client-side. */
    return value.strings ? serializeTemplate(value) : '';
  }
  return raw ? String(value) : escapeHtml(value);
};
