import { spread } from './spread.js';

/**
 * `@verajs/renderer/tag` — an element whose **tag name** is decided at runtime.
 *
 * A template renderer bakes tag names into its statics; that is what makes template identity work
 * and what every fast path in this renderer depends on. So a runtime tag cannot be a binding — it
 * has to become part of the statics *before* the renderer sees the template, which is what this
 * entry does. Downstream nothing changes: the renderer, `@verajs/ssr` and hydration all receive an
 * ordinary template and are unaware this exists.
 *
 * ```js
 * import { html, tag } from '@verajs/renderer/tag';
 *
 * const HEADING = { 1: tag`h1`, 2: tag`h2`, 3: tag`h3` };
 * const H = HEADING[state.level];
 * html`<${H} class="title">${state.text}</${H}>`;
 * ```
 *
 * **A tag is also a JSX component**, so the same value works in both notations with no compiler
 * change — `<H className="title">{state.text}</H>` compiles to `H({…})`, which is exactly what a
 * capitalized JSX tag already compiles to.
 *
 * Additive, like `@verajs/renderer/spread` and unlike the other entries: it inlines no renderer
 * internals, so it is safe alongside any of them.
 */

/** The brand a tag carries. `_$…$` is exempt from this package's `/^_[a-z]/` property mangling. */
const STATIC = '_$static$';

type Tag = ((props?: Record<string, unknown>) => unknown) & { [STATIC]: string };

/**
 * Spliced statics, keyed by the call site's own `strings` array and then by the tags in it.
 *
 * The cache is the whole reason this works. `_shape === value.strings` is the renderer's identity
 * check, so a fresh array per render would never match and every render would rebuild the subtree.
 * A `WeakMap` on the call site's array means the entries die with the module that holds them, and
 * the inner keys are bounded by the tags in the source — which is exactly what `tag` refusing a
 * string guarantees.
 */
const caches = new WeakMap<TemplateStringsArray, Map<string, string[]>>();

/**
 * The `html` to use in a template containing a runtime tag. With no tags in it, this is the
 * ordinary template shape and costs one loop.
 *
 * It builds `{ _$litType$: 1, strings, values }` directly rather than calling core's `html`, so this
 * entry keeps the renderer's independence from core. The consequence is that a `setHtml` swap does
 * not reach here — which is right, since a swapped `html` belongs to a different renderer and this
 * is a renderer feature.
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]) => {
  let key = '';
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as Tag | undefined;
    if (value && value[STATIC] !== undefined) key += `${i}:${value[STATIC]};`;
    /**
     * A non-tag in **tag position** — `<${name}>` with a string. The refusal is the whole security
     * property of this entry, and it lived only in `tag` itself, which guards interpolation into a
     * tag literal. Reaching the position through `html` instead produced no error and no element:
     * the base scanner reads the expression as an element ref on a tag with no name, and the page
     * gets escaped punctuation where the markup should be.
     *
     * The static before a value is what identifies the position, so this is the one place that can
     * see it. `__DEV__`-only; production carries neither the check nor the text.
     */
    else if (__DEV__ && (strings[i].endsWith('<') || strings[i].endsWith('</'))) {
      throw new Error(
        `tag: a ${value === null ? 'null' : typeof value} cannot become markup. ` +
          `Only a tag may be interpolated into tag position:\n\n` +
          `  const heading = tag\`h\${level}\`;   // built from other tags\n` +
          `  html\`<\${heading}>…</\${heading}>\`\n\n` +
          `That is what keeps the set of tags an app can produce fixed by its source.`
      );
    }
  }
  if (key === '') return { ['_$litType$']: 1, strings, values };

  let byTags = caches.get(strings);
  if (byTags === undefined) caches.set(strings, (byTags = new Map()));
  let spliced = byTags.get(key);
  if (spliced === undefined) {
    spliced = [];
    let run = strings[0];
    for (let i = 0; i < values.length; i++) {
      const value = values[i] as Tag | undefined;
      if (value && value[STATIC] !== undefined) run += value[STATIC] + strings[i + 1];
      else {
        spliced.push(run);
        run = strings[i + 1];
      }
    }
    spliced.push(run);
    byTags.set(key, spliced);
  }

  const bindings: unknown[] = [];
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as Tag | undefined;
    if (!(value && value[STATIC] !== undefined)) bindings.push(value);
  }
  return { ['_$litType$']: 1, strings: spliced, values: bindings };
};

/**
 * React's names, mapped the way `@verajs/jsx` maps them on a written element — so `<H1
 * className="t" disabled={d}>` and `<h1 className="t" disabled={d}>` mean the same thing.
 *
 * Not cosmetic. Passed through raw, `disabled={false}` becomes the attribute `disabled="false"`,
 * and any value at all disables the control; `className` lands as `classname` and never applies.
 *
 * Deliberately duplicated from the transform rather than shared through a package: the two are
 * build-time and runtime, and `tests/jsx-name-mapping.test.mjs` asserts they agree on every key —
 * which is the drift protection a shared module would have bought, without the dependency.
 */
const NAME_MAP: Record<string, string> = { className: 'class', htmlFor: 'for' };
const PROPERTIES: Record<string, string> = { value: '.value', checked: '.checked' };
const DEFAULTS: Record<string, string> = { defaultValue: 'value', defaultChecked: '?checked' };
/**
 * The props that name a BINDING rather than an attribute — and the reason this table is here and
 * not in the transform's twin.
 *
 * The compiler must NOT rewrite these on a component: `<Card ref={r}>` hands `ref` to `Card`, which
 * decides what it means, exactly as React does. But a tag's component forwards to a real element,
 * so at THIS boundary — and only here — `ref` has a binding to become. Before 2026-09-12 it had
 * none: it fell through to the attribute sink and `<H ref={r}>` wrote the FUNCTION'S SOURCE TEXT
 * into the DOM as `ref="el => (got = el)"`, which under SSR shipped the closure body to the client,
 * while the identical `<h1 ref={r}>` bound correctly.
 */
const BINDINGS: Record<string, string> = { ref: '&ref' };
export const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);

export const jsxName = (key: string): string =>
  NAME_MAP[key] ?? PROPERTIES[key] ?? DEFAULTS[key] ?? BINDINGS[key] ?? (BOOLEAN_ATTRIBUTES.has(key) ? `?${key}` : key);

/**
 * Declares a tag name.
 *
 * **A string can never become one.** Only another tag may be interpolated, so the set of tags an
 * app can produce is fixed by its source — which is what keeps a tag out of reach of a request, and
 * incidentally what bounds the template cache. There is no `unsafeStatic` here for the same reason
 * there is no `unsafeHTML`: a sanctioned opt-out reads as blessed in tutorials and in review.
 */
export const tag = (strings: TemplateStringsArray, ...values: unknown[]): Tag => {
  /**
   * A *template tag*, so it is written `` tag`h1` `` and not `tag('h1')`. The call form is the
   * likelier mistake of the two and failed with `Cannot read properties of undefined (reading '0')`,
   * which says nothing about either.
   */
  if (__DEV__ && (!strings || !Array.isArray((strings as unknown as { raw?: unknown[] }).raw)))
    throw new TypeError(
      `tag: expected a template literal and received ${String(strings)}. ` +
        "It is a tagged template — write tag`h1`, not tag('h1')."
    );
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as Tag | undefined;
    if (!value || value[STATIC] === undefined)
      throw new Error('tag: only another tag may be interpolated — a string cannot become markup');
    text += value[STATIC] + strings[i + 1];
  }

  /**
   * The tag is a function, which is what makes it a JSX component: the compiler emits `H({…})` for
   * a capitalized tag, and this is what receives that call. `children` is JSX's own key; everything
   * else goes through `spread`, since the names are not known when this template is written.
   */
  const self = ((
    { children, key, dangerouslySetInnerHTML: rawHtml, ...props }: Record<string, unknown> = {}
  ) => {
    /**
     * **`key` and `dangerouslySetInnerHTML` come out of the bag by name**, because neither is an
     * attribute and the sink they fell into accepts anything. `key` became the literal attribute
     * `key="7"` on the element AND cost the list its identity — rows then reconciled positionally,
     * so focus, scroll and input state followed the index rather than the item.
     *
     * `@verajs/jsx` consumes `key` into `keyed(…)` before this is ever called, so the compiled path
     * never reaches here. This is the HAND-CALL backstop — `H({ key: id })` — where no compiler is
     * looking, and dropping it silently would be a refusal with no channel, hence the warning.
     */
    if (__DEV__ && key !== undefined)
      console.warn(
        `[vera] tag: \`key\` does nothing on a tag component and has been dropped — a key marks a ` +
          `template for list reconciliation, and this call returns one rather than being one.\n` +
          `In JSX, write it and the compiler handles it: \`<Row key=\${id}>\` becomes ` +
          `\`keyed(id, Row({…}))\`. Calling by hand, wrap it yourself: \`keyed(id, Row({…}))\`.`
      );
    /**
     * **`dangerouslySetInnerHTML` cannot work here, and that is a security property rather than a
     * gap.** A tag reaches its element through `spread`, and `spread` REFUSES `.innerHTML` on
     * purpose: its names arrive at runtime, which is what makes that sink unreviewable. Mapping the
     * prop was tried and measured — 37 B for a value `spread` then declined, so the bytes bought a
     * console message. Refused here instead, where the reason can be said.
     */
    if (__DEV__ && rawHtml !== undefined)
      console.warn(
        `[vera] tag: \`dangerouslySetInnerHTML\` is not available on a tag component and has been ` +
          `dropped. A tag binds through \`spread\`, whose names are only known at runtime — so it ` +
          `refuses \`.innerHTML\` outright rather than open an unreviewable HTML sink.\n` +
          `Write the element directly, with the value sanitized first: ` +
          `html\`<\${Tag} .innerHTML=\${trusted}>\` (see the renderer README's security note).`
      );
    const mapped: Record<string, unknown> = {};
    for (const name in props) mapped[jsxName(name)] = props[name];
    return html`<${self} ${spread(mapped)}>${children}</${self}>`;
  }) as Tag;
  self[STATIC] = text;
  return self;
};
