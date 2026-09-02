/**
 * `@verajs/cms/publish` — the build pipeline's home: what runs a build — a browser worker, a Node
 * CLI, or CI, all through this one entry — and what a deployed site must
 * never load. The page renderer, index generator, CSS step and git committer land here; today it
 * is the parse-and-serialize core those steps consume.
 */
export { parseMarkdown, parseInline } from './markdown.js';
export { parseFrontmatter, parseContent } from './frontmatter.js';
export type { Root, Block, Inline, ListItem, ContentFile, FrontmatterMap, FrontmatterValue, Scalar } from './types.js';
export { serializeHtml } from './serialize.js';
/** Publish-side only — the first export the two entries do NOT share: a site reads manifests, it never generates them. */
export { generateManifest, serializeManifest } from './manifest.js';
export type { ContentSource } from './manifest.js';
/** The schema layer — validation is a publish-time concern; a deployed site never re-checks itself. */
export { parseSchema, validateEntry } from './schema.js';
export type { Schema, CollectionSchema, Field, Validation } from './schema.js';
/** The cross-collection taxonomy pass — integrity errors and the usage index. */
export { generateTaxonomies, serializeTaxonomies, checkReferences } from './taxonomy.js';
export { emitJsonSchema, emitJsonSchemas } from './emit.js';
/** The write half: content serialization (round-trip-held) and the staged-workspace committer. */
export { serializeContent } from './write.js';
export { createWriter } from './writer.js';
export type { Writer, WriterOptions, Staged } from './writer.js';
export type { TaxonomyIndex } from './taxonomy.js';
/** The pure query core only — build code queries manifests it just generated; fetching stays in `content`. */
export { queryEntries } from './query.js';
export type { QueryOptions, ReaderEntry } from './query.js';
export type { Manifest, ManifestEntry } from './types.js';
