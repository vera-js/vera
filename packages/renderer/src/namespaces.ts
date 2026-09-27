/**
 * **`@verajs/renderer/namespaces` — a template is parsed in the namespace of the position it lands in.**
 *
 * Wired like `slots`: `wire([renderer, namespaces])`. From then on `` html`<path/>` `` committed inside
 * an `<svg>` is built as SVG, exactly as the platform's fragment parser takes a context element — so
 * a component's children cross a function boundary without anyone choosing `svg\`…\`` for them.
 * `@verajs/jsx` wires it in every module it compiles, because JSX cannot write `svg\`…\``; a template
 * author may wire it or keep choosing tags, and pays nothing unless it is wired.
 *
 * Additive, like `slots`: it imports nothing, and the renderer reaches it only through the wired
 * `'template'` insert point and the sigil-named `_$at$`/`_$ns$` members, which mangling exempts.
 *
 * Namespaces are ASKED OF THE PARSER, not listed: a probe element's `innerHTML` answers which
 * namespace a child takes, so integration points and camelCase names come from the platform. The one
 * exception is `annotation-xml`, where the engines disagree about it as a parsing context.
 */
import type { TemplateResult } from './types.js';

/**
 * The three namespaces, **read off the parser rather than written here**: `<svg>` and `<math>` parse
 * into theirs, and the wrapper is HTML. Built on first use, never at import — this module can be
 * imported where there is no DOM (a server bundle) as long as nothing renders with it there.
 */
let reference: Element | undefined;
const namespaceOf = (index: -1 | 0 | 1): string | null => {
  if (reference === undefined) {
    reference = document.createElement('div');
    reference.innerHTML = '<svg></svg><math></math>';
  }
  return index === -1 ? reference.namespaceURI : (reference.childNodes[index] as Element).namespaceURI;
};

/**
 * **The answer cached on a parent element, under a Symbol** — invisible to `Object.keys` and `for…in`
 * (every other DOM element answers `[]` there), and a plain property store, where `defineProperty`
 * would add a call for every new parent on the create path. Only this module reads it.
 */
const ANSWER = Symbol();
type Cached = Element & { [ANSWER]?: string | null };

type Template = {
  _$at$?: (parent: Node) => Template;
  _$ns$?: string | null;
  constructor: new (result: { _$litType$: number; strings: TemplateStringsArray }) => Template;
};

/**
 * The namespace `tag` takes as a CHILD of `parent`, or `null` for HTML — **asked of the parser**.
 * A clone of the parent is given that child through `innerHTML`, which runs the fragment parser with
 * that element as its context, so integration points answer as the platform answers.
 *
 * **The tag matters only under a MathML parent**, and there it decides: `<svg>` inside
 * `<annotation-xml>` is SVG while any other child is MathML, and `<mglyph>`/`<malignmark>` inside
 * `<mi>`, `<mo>`, `<mn>`, `<ms>`, `<mtext>` stay MathML while any other child is HTML. So a MathML
 * parent is asked with the template's own first tag; every other parent with a stand-in, since its
 * answer is the same for every tag.
 */
const answers: Record<string, Record<string, Record<string, string | null>>> = {};
const childOf = (parent: Element, tag: string): string | null => {
  if (parent.namespaceURI === namespaceOf(-1)) return null;
  /**
   * The one position the probe cannot answer: the engines DISAGREE about `<annotation-xml>` as a
   * fragment parser's context — Chromium reads its `encoding`, Firefox does not — while all three
   * agree in full markup, where the `encoding` on its start tag decides. So the attribute is read.
   */
  if (parent.localName === 'annotation-xml') {
    const encoding = parent.getAttribute('encoding')?.toLowerCase();
    if (encoding === 'text/html' || encoding === 'application/xhtml+xml') return null;
  }
  /**
   * **Cached by namespace and name**, because the parser's answer depends on nothing else here
   * (`annotation-xml`, the one element it can depend on an attribute for, is left above). Unasked,
   * this probe ran once per instance CREATED in a foreign position — a clone and a parse per icon.
   * Nested plain objects rather than a joined string key: building the key cost more than the
   * lookup it served, on a path the renderer walks once per instance.
   */
  const byTag = ((answers[parent.namespaceURI!] ??= {})[parent.localName] ??= {});
  let answer = byTag[tag];
  if (answer === undefined) {
    const probe = parent.cloneNode(false) as Element;
    probe.innerHTML = `<${tag}></${tag}>`;
    const ns = (probe.firstChild as Element | null)?.namespaceURI ?? null;
    byTag[tag] = answer = ns === namespaceOf(-1) ? null : ns;
  }
  return answer;
};

/**
 * Where a position is, from its parent — or, when that parent is still a detached fragment, from the
 * renderer's create-path scope: the template whose instance the fragment is (its own namespace), or
 * `[a list's parent, the scope outside it]` for a row built in a batching fragment.
 */
const within = (node: Node, scope: unknown, tag: string): string | null =>
  node.nodeType === 1
    ? childOf(node as Element, (node as Element).namespaceURI === namespaceOf(1) ? tag : 'x')
    : Array.isArray(scope)
      ? within(scope[0], scope[1], tag)
      : ((scope as Template | null)?._$ns$ ?? null);


export const namespaces = {
  name: '@verajs/renderer/namespaces',
  on: 'template' as const,
  priority: 50,
  /**
   * Typed as the `'template'` insert point declares it — the renderer hands its own template as an
   * `object` — so `wire([renderer, namespaces])` type-checks for a consumer; the sigil-named members
   * this module uses are its own view of that object.
   */
  fn: (built: object, result: Pick<TemplateResult, '_$litType$' | 'strings'>, read: () => unknown): void => {
    const template = built as Template;
    const type = result._$litType$ ?? 1;
    if (type !== 1) {
      template._$ns$ = namespaceOf((type - 2) as 0 | 1);
      return;
    }
    /** The `svg` and `mathml` builds of this template's markup, made the first time one is needed. */
    let svg: Template | undefined;
    let mathml: Template | undefined;
    /** The template's first tag, which a MathML parent's answer depends on; `x` when it opens with text. */
    const tag = /^\s*<([a-zA-Z][^\s/>]*)/.exec(result.strings[0])?.[1] ?? 'x';
    const pick = (ns: string | null): Template =>
      ns === null
        ? template
        : ns === namespaceOf(0)
          ? (svg ??= new template.constructor({ _$litType$: 2, strings: result.strings }))
          : (mathml ??= new template.constructor({ _$litType$: 3, strings: result.strings }));
    template._$at$ = (parent) => {
      /** The cache first: it is only ever written on an element, so a hit skips the `nodeType` read. */
      const cached = (parent as Cached)[ANSWER];
      if (cached !== undefined) return pick(cached);
      if (parent.nodeType !== 1) return pick(within(parent, read(), tag));
      /**
       * **The answer is cached ON the parent element.** Every row of a list shares one parent, and once
       * this module is wired EVERY `html` instance on the page asks — plain HTML lists included — so
       * the common case has to be one property read. Two other homes were measured and rejected: a
       * `WeakRef` to the last parent cost Firefox 8.7% on plain HTML creation (`deref()` per row), and
       * a strong reference would keep a removed subtree alive for the life of the cached template.
       * On the element, the answer lives and dies with the thing it describes.
       */
      /**
       * Not cached under a MathML parent: its answer depends on the tag, and for `annotation-xml` on
       * an `encoding` a binding can change later. MathML is rare enough that asking each time is free.
       */
      if ((parent as Element).namespaceURI === namespaceOf(1)) return pick(childOf(parent as Element, tag));
      const answer = childOf(parent as Element, 'x');
      (parent as Cached)[ANSWER] = answer;
      return pick(answer);
    };
  },
};

