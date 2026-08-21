import { setRenderer } from '@verajs/inserts';

/** Set when the default renderer meets a function value, so the warning fires once, not per render. */
let warned = false;

/**
 * Serializes a template value for {@link defaultRenderer}.
 *
 * Escaping happens here, at the render boundary: the template's static `strings` are
 * author-written code and pass through raw, while every interpolated **value** is escaped
 * (`& < > " '`) so data cannot inject markup or break out of an attribute. Nested templates and
 * arrays of them (`.map()` lists) flatten recursively; `null`/`undefined`/`false` render as
 * nothing. Function values cannot survive serialization — `@event` / `.prop` bindings are the
 * renderer module's job — so they render as nothing and warn once.
 *
 * Matching is by **shape** (`.strings`), not identity, so anything template-literal-shaped
 * flattens — core's own `html`/`svg` output, or lit's after a `setHtml` swap.
 */
const toHtml = (value: unknown): string => {
  if (value == null || value === false) return '';
  if (Array.isArray(value)) return value.map(toHtml).join('');
  const template = value as { strings?: readonly string[]; values?: unknown[] };
  if (template.strings) {
    let markup = template.strings[0];
    for (let i = 0; i < template.values!.length; i++) {
      markup += toHtml(template.values![i]) + template.strings[i + 1];
    }
    return markup;
  }
  if (typeof value === 'function') {
    if (!warned) console.warn('[vera] @event/.prop bindings need a renderer module');
    warned = true;
    return '';
  }
  return String(value).replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
};

/**
 * The zero-module default renderer: core alone renders *something*, so a new user in CodePen — or
 * a simple site that trusts its own markup — can activate Vera without adding a renderer module.
 * It handles `html` template objects (values escaped via {@link toHtml}) and plain strings.
 *
 * It lives in core, not `@verajs/inserts`, because it understands **core's template shape** — the
 * registry stays pure mechanism, and standalone module bundles (router alone, for instance) no
 * longer carry it: they render nothing until `setRenderer` is called, which is documented.
 *
 * `innerHTML` justification (CODE-PRINCIPLES #8): template `strings` and plain-string templates
 * are author-written code, the same trust as any source file; interpolated *data* is escaped
 * before it gets here. Listeners: inline `onclick="…"` markup works (it is author code), or
 * attach delegated listeners to the host/shadow root, which survives re-renders. Sigil bindings
 * (`@event`, `.prop`, `?bool`, refs, keyed lists) are the upgrade path to `@verajs/renderer`.
 *
 * Exported so it can be **restored** after a swap: `setRenderer(defaultRenderer)`.
 */
export const defaultRenderer = (content: unknown, container: HTMLElement | ShadowRoot) => {
  container.innerHTML = typeof content === 'string' ? content : toHtml(content);
};

/** Registered at priority 50, so any real renderer replaces it via `setRenderer`. */
setRenderer(defaultRenderer);
