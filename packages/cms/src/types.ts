/**
 * The shapes shared across this package: the markdown AST and the frontmatter values.
 *
 * **AST node names are mdast's on purpose** (`heading`, `emphasis`, `thematicBreak`, …) without
 * depending on unified: mdast is the de facto standard AST for markdown (~51M weekly downloads of
 * `remark-parse`), so matching its vocabulary keeps every future reader — human, tooling, or
 * agent — on familiar ground, at the cost of nothing.
 */

/** Every inline position: the children of headings, paragraphs, emphasis, and link text. */
export type Inline =
  | { type: 'text'; value: string }
  | { type: 'html'; value: string }
  | { type: 'inlineCode'; value: string }
  | { type: 'emphasis'; children: Inline[] }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; url: string; title: string | null; children: Inline[] }
  | { type: 'image'; url: string; title: string | null; alt: string };

/** Every block position: the children of the root, blockquotes, and list items. */
export type Block =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'blockquote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; children: ListItem[] }
  | { type: 'code'; lang: string | null; value: string }
  | { type: 'thematicBreak' }
  | { type: 'html'; value: string };

export type ListItem = { type: 'listItem'; children: Block[] };

export type Root = { type: 'root'; children: Block[] };

export type Scalar = string | number | boolean | null;
export type FrontmatterValue = Scalar | Scalar[] | FrontmatterMap | FrontmatterMap[];
export type FrontmatterMap = { [key: string]: FrontmatterValue };

export type ContentFile = {
  /** The parsed frontmatter fields; `{}` when the file opens with no `---` block. */
  data: FrontmatterMap;
  /** Everything after the closing fence, unparsed. */
  body: string;
};

/** One entry's row in a collection manifest — its metadata, never its body. */
export type ManifestEntry = {
  /** The entry's address within its collection, derived from the file name. */
  slug: string;
  /** The entry's stable identity, when its frontmatter carries one; references key on this. */
  uuid: string | null;
  /** The frontmatter fields, verbatim. */
  data: FrontmatterMap;
  /** The first paragraph as plain text, for listings — null when the body opens with something else. */
  excerpt: string | null;
};

export type Manifest = {
  /** The manifest format, versioned from the first release so future readers can tell shapes apart. */
  version: 1;
  collection: string;
  /** Sorted by slug — determinism is the point, and consumers order by their own fields at query time. */
  entries: ManifestEntry[];
};

/* ── The package's remaining shared shapes, consolidated here in the conventions pass ──────
 * (2026-09-12): seventeen declarations lived beside their first users across eight files —
 * cross-file and entry-public, so the Types rule puts them at the import-graph root. Origin
 * noted per group; behavior untouched. ─────────────────────────────────────────────────── */

/* from schema.ts — the authoring contract */
export type Field =
  | { type: 'string' | 'text' | 'number' | 'boolean' | 'date' | 'image'; required?: boolean }
  | { type: 'select'; options: string[]; required?: boolean }
  | { type: 'reference'; collection: string; required?: boolean }
  | { type: 'list'; of: 'string' | 'number'; required?: boolean }
  /**
   * Term slugs from a taxonomy — and the taxonomy IS a collection, whose entries are the terms
   * (a term is content: it has a title, a description body, an image if it wants one). The value
   * is a list of slugs; whether every slug names a real term is checked across collections at
   * publish, not here — one file cannot see another.
   */
  | { type: 'taxonomy'; taxonomy: string; required?: boolean };

export type CollectionSchema = {
  /** Declared fields by name. The implicit three are not declared here. */
  fields?: { [name: string]: Field };
  /** `false` for label-less collections; absent means titled. */
  title?: false;
  /** `false` for data-only collections; absent means the markdown body exists. */
  body?: false;
};

export type Schema = {
  version: 1;
  collections: { [name: string]: CollectionSchema };
};

export type Validation = {
  /** Broken promises — a declared field violated. The publish fails on any of these. */
  errors: string[];
  /** Degradations — unknown fields, missing implicit ones. The publish continues. */
  warnings: string[];
};

/* from manifest.ts */
export type ContentSource = {
  /** The file's name within its collection folder, e.g. `hello-world.md`. */
  name: string;
  /** The file's full text. */
  text: string;
};

/* from query.ts — the read-side surface */
export type ReaderEntry = ManifestEntry & { collection: string };

export type QueryOptions<E extends ManifestEntry> = {
  /** Keep an entry when this answers true. Absent, everything qualifies. */
  filter?: (entry: E) => boolean;
  /**
   * `'field'` ascending or `'field:desc'` — `date:desc` is the archetype. The field resolves from
   * the entry's frontmatter first, then the row itself (`slug` works). Absent, manifest order —
   * slug-sorted — stands.
   */
  sort?: string;
  /** Rows to skip before taking, for pagination. */
  offset?: number;
  /** Most rows to return. */
  limit?: number;
};

/* from reader.ts */
export type ReaderOptions = {
  /**
   * Where manifests live, ending in `/` — `${url}${collection}.json`. Defaults to `/_manifests/`,
   * the underscore matching static-platform convention for infrastructure files. Absolute URLs
   * work too, which is how one site reads another's manifests.
   */
  url?: string;
};

export type Reader = {
  /** One entry by its address, or null — a missing entry is an answer, not an error. */
  entry(collection: string, slug: string): Promise<ReaderEntry | null>;
  /** One entry by its identity — how a `reference` field's value resolves to the row it names. */
  byUuid(collection: string, uuid: string): Promise<ReaderEntry | null>;
  /** Entries from one collection or several, filtered/sorted/sliced; rows say where they came from. */
  entries(collection: string | string[], options?: QueryOptions<ReaderEntry>): Promise<ReaderEntry[]>;
  /** The raw manifest, cached — for anything the query surface does not cover. */
  manifest(collection: string): Promise<Manifest>;
  /**
   * A taxonomy's terms, ready for a cloud or a nav: the term entries (title, body-derived excerpt,
   * whatever their files carry) with usage counts joined on from the generated index. Terms nobody
   * uses arrive with `count: 0` — an archive page can decide not to link them.
   */
  terms(taxonomy: string): Promise<(ReaderEntry & { count: number })[]>;
};

/* from taxonomy.ts */
export type TaxonomyIndex = {
  version: 1;
  /** taxonomy -> term slug -> where it is used. Terms nobody uses appear with count 0. */
  taxonomies: {
    [taxonomy: string]: {
      [term: string]: { count: number; collections: { [collection: string]: number } };
    };
  };
};

/* from dom.ts */
export type BuildDomOptions = {
  /** The document to create nodes with. Defaults to the global — a page, a worker shim, jsdom. */
  document?: Document;
};

/* from node.ts — the generator's CLI-facing shapes */
export type BuildOptions = {
  /** The content root — one subdirectory per collection. Default `content`. */
  content?: string;
  /** Where the artifacts go. Default `_manifests`, which is where `createReader` looks. */
  out?: string;
};

export type BuildResult = {
  /** Every file written, `site.json` included, in written order. */
  written: string[];
  /** The generator's warnings, prefixed with nothing — presentation is the caller's. */
  warnings: string[];
};

export type CheckResult = {
  /** Artifacts whose bytes differ from what the content produces now. */
  stale: string[];
  /** Artifacts the content calls for that are not on disk at all. */
  missing: string[];
  /**
   * Artifacts on disk the content no longer produces — a deleted collection's committed manifest,
   * still deployed and still answering queries for content that does not exist. The first check
   * only compared the expected set, so an orphan passed silently; found by the 2026-09 audit.
   */
  orphaned: string[];
};

/* from writer.ts — the publish-side surface */
export type WriterOptions = {
  /** `owner/name`, the repository this writer commits into. */
  repo: string;
  /** The branch to pin and publish to. Default `main`; an editorial flow points this at a session branch. */
  branch?: string;
  /** The token, or a function producing one — never stored beyond the call that needs it. */
  token: string | (() => string | Promise<string>);
  /** The API root; override for GitHub Enterprise or a test double. */
  api?: string;
};

export type Staged = { path: string; text: string | null };

export type Writer = {
  /** Pins the branch head this session edits against. Required before publish; safe to re-call. */
  open(): Promise<{ base: string }>;
  /** Stages one content entry — serialized, uuid added at creation if the data carries none. */
  stage(collection: string, slug: string, entry: { data: FrontmatterMap; body: string }): void;
  /** Stages any file — how generated artifacts (manifests, contracts) ride the same commit. */
  stageFile(path: string, text: string): void;
  /** Stages a content entry's removal. */
  remove(collection: string, slug: string): void;
  /** Stages any file's removal. */
  removeFile(path: string): void;
  /** What would publish: every staged path, removals marked null. */
  status(): { base: string | null; staged: Staged[] };
  /** Drops one staged path, or everything. */
  discard(path?: string): void;
  /** Everything staged, as one commit. The overlay clears only when the ref lands. */
  publish(options: { message: string }): Promise<{ commit: string }>;
};

