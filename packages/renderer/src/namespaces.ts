/**
 * **`@verajs/renderer/namespaces` — a template is parsed in the namespace of the position it lands in.**
 *
 * `wire([renderer, namespaces])`, and `` html`<path/>` `` committed inside an `<svg>` is built as SVG — as the
 * platform's fragment parser treats markup given a context element — so a component's children cross a function
 * boundary without anyone choosing `svg\`…\`` for them. `@verajs/jsx` wires it for every module it compiles, because
 * JSX cannot write `svg\`…\``. An app that does not wire it pays nothing.
 *
 * It imports nothing: the renderer reaches it through the `'template'` insert, and it answers through the
 * sigil-named `_$at$` (which template to build at a position) and `_$ns$` (a template's own namespace), which
 * mangling leaves alone. **The child namespace is asked of the PARSER**, not written down — integration points
 * (`<foreignObject>`, `<annotation-xml>`, MathML's text elements) answer as the engine answers — with one exception
 * the engines disagree about.
 */
import type { TemplateResult } from './types.js';

/** The three namespaces — fixed by the specifications, so written rather than read off a probe element. */
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';
const MATHML = 'http://www.w3.org/1998/Math/MathML';

/** The renderer's template, as this module sees it: two sigil-named members and a way to build a variant. */
type Template = {
  _$at$?: (parent: Node) => Template;
  _$ns$?: string | null;
  constructor: new (result: { _$litType$: number; strings: TemplateStringsArray }) => Template;
};

/**
 * **The namespace a `tag` takes as a child of `parent`** (`null` for HTML), asked of the parser: a shallow clone of
 * the parent is handed that child through `innerHTML`, which runs the fragment parser with it as the context. Cached
 * by the parent's KIND — namespace and name — and the tag, because nothing else decides it: one probe per kind of
 * parent for the life of the page, and no DOM node held. Nested objects rather than a joined key: building the key
 * cost more than the lookup, on a path walked once per instance.
 *
 * **The tag decides only under a MathML parent**: `<svg>` in `<annotation-xml>` is SVG where any other child is
 * MathML, and `<mglyph>`/`<malignmark>` stay MathML inside `<mi>`/`<mo>`/`<mn>`/`<ms>`/`<mtext>` where any other child
 * is HTML. Every other parent is asked with a stand-in tag, since its answer is the same for all.
 */
const answers: Record<string, Record<string, Record<string, string | null>>> = {};
const childOf = (parent: Element, tag: string): string | null => {
  if (parent.namespaceURI === HTML) return null;
  /**
   * The one context the probe cannot answer: the engines DISAGREE about `<annotation-xml>` as a fragment parser's
   * context — Chromium reads its `encoding`, Firefox does not — while all agree in full markup, where the `encoding`
   * on its start tag decides. So the attribute is read, and the answer is not cached (a binding can change it).
   */
  if (parent.localName === 'annotation-xml') {
    const encoding = parent.getAttribute('encoding')?.toLowerCase();
    if (encoding === 'text/html' || encoding === 'application/xhtml+xml') return null;
  }
  const byTag = ((answers[parent.namespaceURI!] ??= {})[parent.localName] ??= {});
  let answer = byTag[tag];
  if (answer === undefined) {
    const probe = parent.cloneNode(false) as Element;
    probe.innerHTML = `<${tag}></${tag}>`;
    const ns = (probe.firstChild as Element | null)?.namespaceURI ?? null;
    byTag[tag] = answer = ns === HTML ? null : ns;
  }
  return answer;
};

/**
 * **A parent element's answer, cached ON it** under a Symbol — the fast path: every row of a list shares one parent,
 * and once this is wired EVERY `html` instance asks, so the common case must be one property read, not the
 * `namespaceURI`/`localName` reads the kind cache needs. A string stored on the element holds nothing and dies with
 * it (measured alternatives: a `WeakRef` to the last parent cost Firefox 8.7% on plain creation; a strong reference
 * would keep a removed subtree alive). Invisible to `Object.keys` and `for…in`. Not used under a MathML parent, whose
 * answer depends on the tag.
 */
const ANSWER = Symbol();
type Cached = Element & { [ANSWER]?: string | null };

export const namespaces = {
  name: '@verajs/renderer/namespaces',
  on: 'template' as const,
  priority: 50,
  /**
   * Typed as the `'template'` insert declares it — the renderer hands its template as an `object` — so
   * `wire([renderer, namespaces])` type-checks for a consumer; the sigil-named members are this module's view of it.
   */
  fn: (built: object, result: Pick<TemplateResult, '_$litType$' | 'strings'>, readScope: () => unknown): void => {
    const template = built as Template;
    const type = result._$litType$ ?? 1;
    /** An `svg\`…\``/`mathml\`…\`` template — or a variant this module built — is in its namespace already. */
    if (type !== 1) {
      template._$ns$ = type === 2 ? SVG : MATHML;
      return;
    }
    /**
     * The template's first ELEMENT's tag — past leading text, comments and expressions (`<!--c--><svg>`, `label <svg>`,
     * `${x}<svg>`), `x` when it has none — which is what a MathML parent's answer depends on.
     */
    const tag = /<([a-zA-Z][^\s/>]*)/.exec(result.strings.join('').replace(/<!--[\s\S]*?-->/g, ''))?.[1] ?? 'x';
    /** Its SVG and MathML builds, made the first time one is needed — the renderer's own constructor, so every
     *  construction-time decision (every refusal) is made again there, never copied. */
    let svg: Template | undefined;
    let mathml: Template | undefined;
    const pick = (ns: string | null): Template =>
      ns === null
        ? template
        : ns === SVG
          ? (svg ??= new template.constructor({ _$litType$: 2, strings: result.strings }))
          : (mathml ??= new template.constructor({ _$litType$: 3, strings: result.strings }));
    template._$at$ = (parent) => {
      const cached = (parent as Cached)[ANSWER];
      if (cached !== undefined) return pick(cached);
      /** Still inside an instance's detached clone: the template being built answers, with its own namespace. */
      if (parent.nodeType !== 1) return pick((readScope() as Template | null)?._$ns$ ?? null);
      if ((parent as Element).namespaceURI === MATHML) return pick(childOf(parent as Element, tag));
      return pick(((parent as Cached)[ANSWER] = childOf(parent as Element, 'x')));
    };
  },
};
