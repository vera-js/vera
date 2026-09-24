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

/** A parent element carrying the namespace its children parse in, once asked. */
type Cached = Element & { _$vns$?: string | null };

type Template = {
  _$at$?: (parent: Node) => Template;
  _$ns$?: string | null;
  constructor: new (result: { _$litType$: number; strings: TemplateStringsArray }) => Template;
};

/**
 * The namespace a start tag takes as a CHILD of `parent`, or `null` for HTML — **asked of the parser**.
 * A clone of the parent is given one unknown child through `innerHTML`, which runs the fragment
 * parser with that element as its context, so integration points answer as the platform answers.
 */
const answers: Record<string, Record<string, string | null>> = {};
const childOf = (parent: Element): string | null => {
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
  const byName = (answers[parent.namespaceURI!] ??= {});
  let answer = byName[parent.localName];
  if (answer === undefined) {
    const probe = parent.cloneNode(false) as Element;
    probe.innerHTML = '<x></x>';
    const ns = (probe.firstChild as Element | null)?.namespaceURI ?? null;
    byName[parent.localName] = answer = ns === namespaceOf(-1) ? null : ns;
  }
  return answer;
};

/**
 * Where a position is, from its parent — or, when that parent is still a detached fragment, from the
 * renderer's create-path scope: the template whose instance the fragment is (its own namespace), or
 * `[a list's parent, the scope outside it]` for a row built in a batching fragment.
 */
const within = (node: Node, scope: unknown): string | null =>
  node.nodeType === 1
    ? childOf(node as Element)
    : Array.isArray(scope)
      ? within(scope[0], scope[1])
      : ((scope as Template | null)?._$ns$ ?? null);


export const namespaces = {
  name: '@verajs/renderer/namespaces',
  on: 'template' as const,
  priority: 50,
  fn: (template: Template, result: TemplateResult, read: () => unknown): void => {
    const type = result._$litType$ ?? 1;
    if (type !== 1) {
      template._$ns$ = namespaceOf((type - 2) as 0 | 1);
      return;
    }
    /** The `svg` and `mathml` builds of this template's markup, made the first time one is needed. */
    let svg: Template | undefined;
    let mathml: Template | undefined;
    const pick = (ns: string | null): Template =>
      ns === null
        ? template
        : ns === namespaceOf(0)
          ? (svg ??= new template.constructor({ _$litType$: 2, strings: result.strings }))
          : (mathml ??= new template.constructor({ _$litType$: 3, strings: result.strings }));
    template._$at$ = (parent) => {
      /** The cache first: it is only ever written on an element, so a hit skips the `nodeType` read. */
      const cached = (parent as Cached)._$vns$;
      if (cached !== undefined) return pick(cached);
      if (parent.nodeType !== 1) return pick(within(parent, read()));
      /**
       * **The answer is cached ON the parent element.** Every row of a list shares one parent, and once
       * this module is wired EVERY `html` instance on the page asks — plain HTML lists included — so
       * the common case has to be one property read. Two other homes were measured and rejected: a
       * `WeakRef` to the last parent cost Firefox 8.7% on plain HTML creation (`deref()` per row), and
       * a strong reference would keep a removed subtree alive for the life of the cached template.
       * On the element, the answer lives and dies with the thing it describes.
       */
      const answer = childOf(parent as Element);
      /** Not for `annotation-xml`: its answer follows an `encoding` a binding can change later. */
      if ((parent as Element).localName !== 'annotation-xml') (parent as Cached)._$vns$ = answer;
      return pick(answer);
    };
  },
};

