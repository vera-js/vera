/**
 * The DOM builder: the AST out of `markdown.ts`, built into real nodes — the runtime twin of
 * `serialize.ts`, for pages that render content client-side. Structured nodes are constructed with
 * `createElement`/`createTextNode`, which cannot mis-escape anything because nothing is ever a
 * string of markup; hand the fragment to a renderer that accepts nodes and no article-sized
 * `innerHTML` exists anywhere in the page.
 *
 * **Except one, contained and documented — the same sink `serializeHtml` has.** Content carries
 * raw HTML by design (the author's own repository; a component in prose is the feature), and raw
 * HTML must be parsed by something. Each `html` node's value goes through a `<template>` — inert
 * parsing, no scripts execute during it — and only those author-written fragments do; the prose,
 * structure, links and code around them never touch a parser. A consumer who cannot accept even
 * that much parses nothing by skipping `html` nodes... at the price of D1, which is why that is
 * not the default.
 *
 * Where the two serializers must agree, they encode the SAME decisions: the tight-list rule
 * (paragraphs directly inside an item lose their wrapper) and the `language-*` class convention
 * live in both, and the differential suite holds them together — a divergence is a bug in
 * whichever one moved. **One accepted exception**: elements with special parser semantics used
 * INLINE in prose — a `<table>` mid-sentence (foster-parenting), `<template>` (its children live
 * in `.content`), raw-text elements like `<script>` — can build differently here than the string
 * path's full parser reassembles them. Their block form passes through both paths via one parse
 * and agrees exactly; inline is prose position, and prose position is for prose-shaped tags.
 */
import { Block, Inline, ListItem, Root } from './types.js';

export type BuildDomOptions = {
  /** The document to create nodes with. Defaults to the global — a page, a worker shim, jsdom. */
  document?: Document;
};

/**
 * Builds a parsed tree into a DocumentFragment.
 *
 * @param root The tree out of `parseMarkdown`
 * @param options The document to build with, when the global one is not it
 * @return A fragment ready to insert — custom elements in it upgrade on insertion, as always
 */
export const buildDom = (root: Root, options: BuildDomOptions = {}): DocumentFragment => {
  const doc = options.document ?? globalThis.document;
  const fragment = doc.createDocumentFragment();
  for (const child of root.children) fragment.append(block(child, doc));
  return fragment;
};

const block = (node: Block, doc: Document): Node => {
  switch (node.type) {
    case 'heading': {
      const heading = doc.createElement(`h${node.depth}`);
      heading.append(...inlines(node.children, doc));
      return heading;
    }
    case 'paragraph': {
      const paragraph = doc.createElement('p');
      paragraph.append(...inlines(node.children, doc));
      return paragraph;
    }
    case 'blockquote': {
      const quote = doc.createElement('blockquote');
      for (const child of node.children) quote.append(block(child, doc));
      return quote;
    }
    case 'list': {
      const list = doc.createElement(node.ordered ? 'ol' : 'ul');
      if (node.ordered && node.start !== 1) list.setAttribute('start', String(node.start));
      for (const item of node.children) list.append(listItem(item, doc));
      return list;
    }
    case 'code': {
      const pre = doc.createElement('pre');
      const code = doc.createElement('code');
      if (node.lang !== null) code.className = `language-${node.lang}`;
      code.textContent = node.value;
      pre.append(code);
      return pre;
    }
    case 'thematicBreak':
      return doc.createElement('hr');
    case 'html':
      return raw(node.value, doc);
  }
};

/** The tight-list rule, the serializer's decision made with nodes: item paragraphs lose their wrapper. */
const listItem = (item: ListItem, doc: Document): HTMLLIElement => {
  const li = doc.createElement('li');
  for (const child of item.children) {
    if (child.type === 'paragraph') li.append(...inlines(child.children, doc));
    else li.append(block(child, doc));
  }
  return li;
};

/** The one sink (see the header): an author-written fragment, parsed inertly, scripts not run. */
const raw = (value: string, doc: Document): DocumentFragment => {
  const template = doc.createElement('template');
  template.innerHTML = value;
  return template.content;
};

/** Elements that cannot hold children, so an open tag of one is complete, never a container. */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * **Inline `html` nodes are tag FRAGMENTS, and the differential suite caught what that means.**
 * `Raw <mark>inline</mark> html.` parses to five nodes — text, `<mark>`, text, `</mark>`, text —
 * and parsing each fragment alone auto-closes the tag, leaving `<mark></mark>inline`: the prose
 * falls outside the element the author wrapped it in. The string serializer never sees the problem
 * because it reassembles the text before any parser runs.
 *
 * So this reconstructs the nesting the fragments describe: an opening tag becomes the container
 * the following nodes append into, and its closing tag pops it — which also means markdown BETWEEN
 * the tags (`<mark>*em*</mark>`) lands inside the element as built nodes, matching the string
 * path's meaning exactly. Mis-nesting degrades gracefully: a close with no matching open is
 * dropped, an open never closed stays open to the end of its run — both what a browser makes of
 * the same fragments in the simple cases this subset serves.
 */
const inlines = (nodes: Inline[], doc: Document): Node[] => {
  const roots: Node[] = [];
  const stack: Element[] = [];
  const sink = (node: Node) => (stack.length > 0 ? stack[stack.length - 1].append(node) : roots.push(node));

  for (const node of nodes) {
    if (node.type !== 'html') {
      sink(inline(node, doc));
      continue;
    }
    const closing = /^<\/([a-zA-Z][a-zA-Z0-9-]*)\s*>$/.exec(node.value);
    if (closing !== null) {
      const name = closing[1].toLowerCase();
      /** A reverse loop, not findLastIndex — the build targets a lib that predates it (audit pass 4). */
      let at = -1;
      for (let i = stack.length - 1; i >= 0; i--)
        if (stack[i].localName === name) {
          at = i;
          break;
        }
      if (at !== -1) stack.length = at; // pops the match and anything left open inside it
      continue;
    }
    const content = raw(node.value, doc);
    const element = content.firstChild;
    /**
     * The container decision reads the PARSED element instead of re-regexing the text — the
     * fragment already went through the platform's parser, which handles quoted `>` and every
     * other attribute shape a second regex would re-litigate badly. An open tag is: parses to one
     * childless, non-void element — and `/>` does NOT close one, because HTML has no self-closing
     * for non-void elements and the string path's parser ignores the slash; honoring it here made
     * the twins disagree about `<x-y/>` (audit pass 8).
     */
    if (
      content.childNodes.length === 1 &&
      element !== null &&
      element.nodeType === 1 &&
      !VOID.has((element as Element).localName) &&
      (element as Element).childNodes.length === 0
    ) {
      sink(element);
      stack.push(element as Element);
    } else {
      /** Void, a comment, or anything else complete: appended as parsed. */
      for (const child of [...content.childNodes]) sink(child);
    }
  }
  return roots;
};

const inline = (node: Inline, doc: Document): Node => {
  switch (node.type) {
    case 'text':
      return doc.createTextNode(node.value);
    case 'html':
      return raw(node.value, doc);
    case 'inlineCode': {
      const code = doc.createElement('code');
      code.textContent = node.value;
      return code;
    }
    case 'emphasis': {
      const em = doc.createElement('em');
      em.append(...inlines(node.children, doc));
      return em;
    }
    case 'strong': {
      const strong = doc.createElement('strong');
      strong.append(...inlines(node.children, doc));
      return strong;
    }
    case 'link': {
      const anchor = doc.createElement('a');
      anchor.setAttribute('href', node.url);
      if (node.title !== null) anchor.setAttribute('title', node.title);
      anchor.append(...inlines(node.children, doc));
      return anchor;
    }
    case 'image': {
      const img = doc.createElement('img');
      img.setAttribute('src', node.url);
      img.setAttribute('alt', node.alt);
      if (node.title !== null) img.setAttribute('title', node.title);
      return img;
    }
  }
};
