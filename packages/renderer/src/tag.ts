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
export const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);

export const jsxName = (key: string): string =>
  NAME_MAP[key] ?? PROPERTIES[key] ?? DEFAULTS[key] ?? (BOOLEAN_ATTRIBUTES.has(key) ? `?${key}` : key);

/**
 * Declares a tag name.
 *
 * **A string can never become one.** Only another tag may be interpolated, so the set of tags an
 * app can produce is fixed by its source — which is what keeps a tag out of reach of a request, and
 * incidentally what bounds the template cache. There is no `unsafeStatic` here for the same reason
 * there is no `unsafeHTML`: a sanctioned opt-out reads as blessed in tutorials and in review.
 */
export const tag = (strings: TemplateStringsArray, ...values: unknown[]): Tag => {
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
  const self = (({ children, ...props }: Record<string, unknown> = {}) => {
    const mapped: Record<string, unknown> = {};
    for (const key in props) mapped[jsxName(key)] = props[key];
    return html`<${self} ${spread(mapped)}>${children}</${self}>`;
  }) as Tag;
  self[STATIC] = text;
  return self;
};
