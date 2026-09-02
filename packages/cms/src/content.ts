/**
 * `@verajs/cms/content` — the runtime read path: what a *deployed site* may load. Parse a content
 * file, query it, render it. Nothing here will ever commit, build, or talk to GitHub — that is
 * `./publish`'s side of the boundary, and the boundary existing from the first commit is what
 * keeps a visitor's bundle from quietly inheriting a git committer.
 *
 * Today the two entries share everything; they diverge when this one gains the DOM builder
 * (AST straight to nodes, so vera's renderer keeps its no-`innerHTML` property) and the manifest
 * query API. `serializeHtml` is exported here too for the buildless
 * fallback and for non-vera consumers, whose own raw-HTML mechanism is their documented sink.
 */
export { parseMarkdown, parseInline } from './markdown.js';
export { parseFrontmatter, parseContent } from './frontmatter.js';
export type { Root, Block, Inline, ListItem, ContentFile, FrontmatterMap, FrontmatterValue, Scalar } from './types.js';
export { serializeHtml } from './serialize.js';
/** The read path proper: the pure query core, and the fetching reader over it. */
export { queryEntries } from './query.js';
export type { QueryOptions, ReaderEntry } from './query.js';
export { createReader } from './reader.js';
/** The runtime twin of serializeHtml: AST to real nodes, no article-sized innerHTML anywhere. */
export { buildDom } from './dom.js';
export type { BuildDomOptions } from './dom.js';
export type { Reader, ReaderOptions } from './reader.js';
export type { Manifest, ManifestEntry } from './types.js';
