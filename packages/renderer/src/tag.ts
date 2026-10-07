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

/** The 14 void elements — the renderer's development tag-shape pass reads the same list. */
const VOID_TAGS = /^(?:area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr|param)$/i;

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
 * entry keeps the renderer's independence from core.
 */
export const html = (strings: TemplateStringsArray, ...values: unknown[]) => {
  let key = '';
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as Tag | undefined;
    if (value && value[STATIC] !== undefined) {
      /**
       * A tag belongs in TAG position only. Spliced anywhere else it became text, an attribute value, or an attribute
       * NAME (`<p ${T}=${v}>`) — a route around the renderer's refusal of a name expression. Development only: the
       * name text is fixed by source either way, so this is consistency, not safety.
       */
      if (__DEV__ && !(strings[i].endsWith('<') || strings[i].endsWith('</')))
        throw new Error(
          `tag: a tag (\`${value[STATIC]}\`) may only stand in tag position — \`<\${T}>…</\${T}>\`. Spliced anywhere ` +
            `else it would become text or part of an attribute, which a tag never means.`
        );
      key += `${i}:${value[STATIC]};`;
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
    /**
     * A spliced array is a template's strings, so it carries `raw` as a tagged literal's does: that own property is
     * how a renderer tells a template from data shaped like one (parsed JSON cannot give an array a `raw`).
     */
    (spliced as string[] & { raw?: string[] }).raw = spliced;
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
export const BOOLEAN_ATTRIBUTES = new Set([
  'disabled', 'hidden', 'readonly', 'required', 'open', 'selected', 'multiple',
  'autofocus', 'autoplay', 'controls', 'loop', 'muted', 'playsinline', 'inert', 'reversed',
]);
/**
 * ONE table, with no prototype: React's names (`className`, `htmlFor`), the form controls' properties and defaults,
 * the booleans (`?disabled`), and `ref` — the prop that names a BINDING rather than an attribute. The compiler must
 * not rewrite `ref` on a component (`<Card ref={r}>` hands it to `Card`), but a tag's component forwards to a real
 * element, so at THIS boundary it has a binding to become; before 2026-09-12 it fell through to the attribute sink
 * and wrote the function's SOURCE TEXT into the DOM.
 *
 * No prototype, because four plain object literals answered for `constructor`, `toString` and the rest of
 * `Object.prototype` — those props were mapped to a function, refused as a name, and silently dropped.
 */
const NAMES = {
  __proto__: null,
  className: 'class',
  htmlFor: 'for',
  /** Controlled, compared with the control's LIVE state — the compiler's twin (`@verajs/jsx`) maps them the same. */
  value: '!value',
  checked: '!checked',
  defaultValue: 'value',
  defaultChecked: '?checked',
  ref: '&ref',
} as unknown as Record<string, string>;
for (const name of BOOLEAN_ATTRIBUTES) NAMES[name] = `?${name}`;

export const jsxName = (key: string): string => NAMES[key] ?? key;

/**
 * **On a CUSTOM element a bare prop is a PROP** — exactly the rule `@verajs/jsx` compiles `<my-el foo={x}>` by: React's
 * renames first (`className` → `class`, `htmlFor` → `for`), `ref` its binding, a sigil or `on…` passed through, and any
 * other name that could be a JS property becomes `.name` — the HTML-control guesses (`?disabled`, `.value`) never reach
 * a component, whose `disabled` is its own prop. A name that cannot be a property (`data-x`, `aria-label`) and the two
 * names the DOM itself renamed (`class`, `for`) stay attributes.
 */
const componentName = (key: string): string =>
  key === 'className'
    ? 'class'
    : key === 'htmlFor'
      ? 'for'
      : key === 'ref'
        ? '&ref'
        : /^[.?@&!]|^on[A-Z]/.test(key) || !/^[A-Za-z_$][\w$]*$/.test(key) || key === 'class' || key === 'for'
          ? key
          : `.${key}`;


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
  /**
   * In EVERY build: in production `tag('h1')` read the STRING's first character as the template's first static and
   * named an `<h>`, silently — a wrong element only production renders. The explanation is development's.
   */
  if (!(strings as { raw?: unknown } | null)?.raw)
    throw new TypeError(
      __DEV__
        ? `tag: expected a template literal and received ${String(strings)}. ` +
            "It is a tagged template — write tag`h1`, not tag('h1')."
        : 'tag: expected a template literal'
    );
  let text = strings[0];
  for (let i = 0; i < values.length; i++) {
    const value = values[i] as Tag | undefined;
    if (!value || value[STATIC] === undefined)
      throw new Error('tag: only another tag may be interpolated — a string cannot become markup');
    text += value[STATIC] + strings[i + 1];
  }

  /**
   * **A tag's text must be an element NAME.** Until this, it was an unconstrained string spliced
   * straight into the statics — so `` tag`div onclick=x` `` produced markup rather than a tag, and
   * the name of this export was a description of intent rather than of behavior.
   *
   * The concrete failure it closes is a cache collision. Spliced statics key on
   * `` `${i}:${text};` `` per tag, joined with separators the text was free to contain, so two
   * DIFFERENT tag assignments at one call site could derive the same key and reuse each other's
   * markup. Measured: at a two-tag call site, `(a, "b;1:c")` and `("a;1:b", c)` both derive
   * `"0:a;1:b;1:c;"`, and the second render came back as the FIRST one's markup.
   *
   * Escaping the separators would have fixed that one collision. Constraining the name fixes the
   * class — no name can contain a separator, so no key can be ambiguous, and the export delivers
   * what it is called. A closed grammar beats a wider escape, which is the same ruling this audit
   * reached for the attribute-value sink.
   *
   * Unconditional, like the interpolation refusal above and unlike the shape check: both are about
   * what may become markup, and a production build is where that matters most.
   */
  if (!/^[a-zA-Z][a-zA-Z0-9._-]*$/.test(text))
    throw new Error(
      /**
       * The THROW is unconditional; its EXPLANATION is not. Carrying the full sentence cost 178 B
       * gzipped here — most of a 1.9 KB entry — for text an author reads once and a production
       * page never reaches. Core's static-render refusal is shaped the same way for the same
       * measurement.
       */
      __DEV__
        ? `tag: ${JSON.stringify(text)} is not an element name. A tag names ONE element — letters, ` +
          `then letters, digits, '.', '_' or '-' — and nothing else becomes markup here.\n` +
          `Attributes and content belong in the template: html\`<\${heading} class="title">…</\${heading}>\`.`
        : 'tag: not an element name'
    );

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
    /** No prototype, and `__proto__` is no prop: a bag key by that name would otherwise reach `spread` as one. */
    const mapped = { __proto__: null } as unknown as Record<string, unknown>;
    for (const name in props)
      if (name !== '__proto__') {
        /** The compiler refuses an object `style` at build time; written into the attribute it reads "[object Object]". */
        if (__DEV__ && name === 'style' && props[name] !== null && typeof props[name] === 'object')
          throw new TypeError('tag: `style` expects a STRING (e.g. style: `color:${c}`), not an object — as in Vera JSX.');
        mapped[(custom ? componentName : jsxName)(name)] = props[name];
      }
    /**
     * A void element has no content and no end tag: `</br>` is read as a SECOND `<br>`, and a child anchor strays. So
     * children given to one would vanish silently — development says so (an empty list is no content).
     */
    if (__DEV__ && empty && children != null && !(Array.isArray(children) && children.length === 0))
      throw new Error(`tag: <${text}> is a void element — it takes no children, and these would be dropped.`);
    return empty ? html`<${self} ${spread(mapped)}>` : html`<${self} ${spread(mapped)}>${children}</${self}>`;
  }) as Tag;
  const empty = VOID_TAGS.test(text);
  /**
   * A custom element's props map by the compiler's component rule — never by the HTML-control guesses. A dash name is
   * enough here: the compiler also excludes eight reserved SVG/MathML names (`font-face`, `annotation-xml`…), which
   * cost 77 B to carry and which a tag essentially never names (Brian, 2026-10-01, on vera-5a's recommendation).
   */
  const custom = text.includes('-');
  self[STATIC] = text;
  return self;
};
