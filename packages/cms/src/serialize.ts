/**
 * The string serializer: the AST out of `markdown.ts`, rendered to an HTML string. This is the
 * static build's renderer — at publish time it produces the markup written into
 * `dist/`, so on the primary path no markdown is ever parsed in a visitor's browser.
 *
 * **`html` nodes are a sink, and this comment is the documentation the API owes you** (the rule
 * `@verajs/ssr` learned with its `children` option): their `value` is emitted verbatim, unescaped,
 * because raw HTML in content — the author's own repository — passes through untouched by design.
 * Everything else is data and is escaped here, at the render boundary, never earlier
 * (CODE-PRINCIPLES #8: escaping early double-escapes).
 *
 * vera's runtime path deliberately does not use this: it gets a DOM builder over the same AST when
 * that path lands, so the renderer's no-`innerHTML` property survives. A non-vera consumer using
 * this string with their framework's raw-HTML mechanism is using *their* documented sink, in their
 * own code, which is exactly where such a decision belongs.
 */
import { Block, Inline, ListItem, Root } from './types.js';

/**
 * The five characters with meaning in markup or attributes. Local rather than shared with
 * `@verajs/ssr`'s escaping on purpose: modules are independent (CODE-PRINCIPLES #6), ssr is
 * Node-only while this runs anywhere, and five entities are not worth a coupling — the same
 * reasoning as the renderer/spread sigil duplication, recorded so nobody "fixes" it into a
 * dependency.
 */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) =>
    ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch === '"' ? '&quot;' : '&#39;'
  );

/**
 * Renders a parsed tree to an HTML string.
 *
 * @param root The tree out of `parseMarkdown`
 * @return The markup, one block per line — text escaped, `html` nodes verbatim (see the header)
 */
export const serializeHtml = (root: Root): string => root.children.map(block).join('\n');

const block = (node: Block): string => {
  switch (node.type) {
    case 'heading':
      return `<h${node.depth}>${inlines(node.children)}</h${node.depth}>`;
    case 'paragraph':
      return `<p>${inlines(node.children)}</p>`;
    case 'blockquote':
      return `<blockquote>\n${node.children.map(block).join('\n')}\n</blockquote>`;
    case 'list': {
      const items = node.children.map(listItem).join('\n');
      return node.ordered
        ? `<ol${node.start === 1 ? '' : ` start="${node.start}"`}>\n${items}\n</ol>`
        : `<ul>\n${items}\n</ul>`;
    }
    case 'code': {
      /** The info string becomes the class convention every highlighter already reads. */
      const lang = node.lang === null ? '' : ` class="language-${escapeHtml(node.lang)}"`;
      return `<pre><code${lang}>${escapeHtml(node.value)}</code></pre>`;
    }
    case 'thematicBreak':
      return '<hr>';
    case 'html':
      return node.value; // the documented sink — see the header
  }
};

/**
 * Tight-list rendering, made here rather than in the parser: every paragraph directly inside an
 * `<li>` loses its `<p>` wrapper — not only a lone one. That is CommonMark's own tight rule, and
 * the first version of this unwrapped only solitary paragraphs, so `- outer` + a nested list
 * rendered `<p>outer</p>` while `- outer` alone rendered bare text: the same item, two shapes,
 * depending on what followed it.
 */
const listItem = (item: ListItem): string => {
  const body = item.children
    .map((child) => (child.type === 'paragraph' ? inlines(child.children) : block(child)))
    .join('\n');
  return `<li>${body}</li>`;
};

const inlines = (nodes: Inline[]): string => nodes.map(inline).join('');

const inline = (node: Inline): string => {
  switch (node.type) {
    case 'text':
      return escapeHtml(node.value);
    case 'html':
      return node.value; // the same sink, inline
    case 'inlineCode':
      return `<code>${escapeHtml(node.value)}</code>`;
    case 'emphasis':
      return `<em>${inlines(node.children)}</em>`;
    case 'strong':
      return `<strong>${inlines(node.children)}</strong>`;
    case 'link': {
      const title = node.title === null ? '' : ` title="${escapeHtml(node.title)}"`;
      return `<a href="${escapeHtml(node.url)}"${title}>${inlines(node.children)}</a>`;
    }
    case 'image': {
      const title = node.title === null ? '' : ` title="${escapeHtml(node.title)}"`;
      return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt)}"${title}>`;
    }
  }
};
