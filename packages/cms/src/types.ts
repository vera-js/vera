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

/**
 * One item of a list, holding blocks — a nested list, a code fence, and ordinarily a paragraph.
 * **The paragraph is in the tree even though neither serializer renders its `<p>`:** every list in
 * this subset is tight, and the unwrapping is a decision `serialize.ts` and `dom.ts` make at output
 * time rather than something the parser drops, so the AST stays mdast-shaped for anything else
 * reading it.
 */
export type ListItem = { type: 'listItem'; children: Block[] };

/**
 * A parsed document — `parseMarkdown`'s return, and the input every serializer and the DOM builder
 * takes. **Frontmatter never appears in here**: `parseFrontmatter` splits it off first, and
 * `parseContent` hands the fields back *beside* this tree rather than inside it.
 */
export type Root = { type: 'root'; children: Block[] };

/**
 * What one frontmatter value position can hold — and the leaf of the `Scalar` → `FrontmatterValue`
 * → `FrontmatterMap` family below.
 *
 * **A date is a string here, deliberately and permanently.** `date: 2026-09-02` parses to
 * `'2026-09-02'` and never to a `Date`, because a `Date` bakes the parsing machine's timezone into
 * the value — a recording carrying one has already gone red in this repo's UTC CI. "This string is
 * a date" is the schema layer's statement to make; `frontmatter.ts` carries the full reasoning.
 */
export type Scalar = string | number | boolean | null;
/**
 * The frontmatter grammar in full: a scalar, an inline or dashed list of scalars, a nested map, or
 * a list of maps — that last one is the navigation-menu shape, which is why it exists.
 *
 * **Arrays never nest.** `[a, [b]]` is refused at parse rather than read as the string `'[b]'`,
 * which is the subset's whole posture: fail loudly with a line number instead of parsing to
 * something almost right. Maps do nest, through `FrontmatterMap`.
 */
export type FrontmatterValue = Scalar | Scalar[] | FrontmatterMap | FrontmatterMap[];
/**
 * One file's frontmatter fields, keyed by name **in the author's own order** — which is part of the
 * input, not of the environment, so it survives into a manifest's bytes and back out of
 * `serializeContent` unshuffled.
 *
 * Keys here are content, not structure. `__proto__` is refused outright by both the parser and the
 * writer (assigning it replaces a prototype instead of creating a field), and every lookup against
 * one of these goes through `Object.hasOwn`, so a field someone called `constructor` reads as a
 * field rather than finding Object's own.
 */
export type FrontmatterMap = { [key: string]: FrontmatterValue };

/**
 * A content file split at its closing fence. The body stays **unparsed** on purpose: the manifest
 * generator walks whole collections and wants only metadata, so parsing every author's prose to
 * reach their frontmatter would be the bulk of a build spent on nothing. `parseContent` is the call
 * that adds `root`, for when the tree is actually wanted.
 */
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

/**
 * A collection's static index: every entry's metadata in one file, so a deployed site — or a
 * browser reading a repository — answers "what exists, with what fields" from **one cached fetch**
 * instead of a request per file, which is the wall every git-backed reader eventually hits against
 * an API rate limit. **No bodies are in here**; an entry's prose is fetched only by whatever
 * renders it.
 *
 * This is a generated artifact that gets committed, which makes its bytes a contract: the same
 * files in must produce the same bytes out on any machine, and `checkManifests` fails a build whose
 * committed copy has drifted.
 */
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
/**
 * One declared frontmatter field — the first of the `Field` → `CollectionSchema` → `Schema` family
 * that makes up a site's authoring contract.
 *
 * **Declaring a field is a promise, and `required` is the only dial on it.** A file that violates a
 * declared field fails the publish outright, while a field the schema says nothing about only
 * warns — hand-edited and mid-migration content carries harmless extras, and blocking a whole site
 * over one stray key punishes the wrong person. `schema.ts` holds the full grading.
 *
 * The four implicit fields are never declared here and `parseSchema` refuses a collection that
 * tries: `uuid` (identity), `title`, the markdown `body`, and `slug`, which is derived from the
 * file name. `date` is deliberately *not* implicit — posts want one, pages do not.
 */
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

/**
 * One collection's contract, and the source of three separate things: what `validateEntry` enforces
 * at publish, what `emitJsonSchema` publishes as the standard JSON Schema document other tools and
 * agents read, and which fields the cross-collection taxonomy and reference passes have to follow.
 *
 * `title` and `body` type as the literal `false` rather than as booleans because they exist only to
 * opt *out* of an implicit field — `title: false` for a label-less collection like redirects,
 * `body: false` for a data-only one like navigation. A `title: true` would read as a declaration,
 * and there is no such thing to declare.
 */
export type CollectionSchema = {
  /** Declared fields by name. The implicit three are not declared here. */
  fields?: { [name: string]: Field };
  /** `false` for label-less collections; absent means titled. */
  title?: false;
  /** `false` for data-only collections; absent means the markdown body exists. */
  body?: false;
};

/**
 * A site's whole `content/schema.json`, parsed and checked — the root of the authoring contract.
 *
 * **Authored as JSON rather than as code**, because it has three writers (a person, the editing
 * tooling, an agent) and code round-trips for only one of them. TypeScript types are generated
 * *from* this, never the reverse, so schemas-as-code DX arrives via codegen instead of `eval`.
 *
 * `version` is checked at load and only `1` is understood — `parseSchema` refuses anything else by
 * name rather than validating content against a shape it is guessing at. Having no schema at all
 * stays legal: a schemaless site publishes unvalidated, exactly as it did before schemas existed.
 */
export type Schema = {
  version: 1;
  collections: { [name: string]: CollectionSchema };
};

/**
 * One entry's verdict, with the graded strictness made structural: `errors` fail the publish and
 * `warnings` never do, so the split is the policy rather than a convention a caller has to know.
 *
 * Both hold finished English sentences, not codes — they end up in front of a person, as a CLI
 * line, a CI annotation or an editor banner, and which of those is the caller's decision. That is
 * also why nothing down here prints.
 */
export type Validation = {
  /** Broken promises — a declared field violated. The publish fails on any of these. */
  errors: string[];
  /** Degradations — unknown fields, missing implicit ones. The publish continues. */
  warnings: string[];
};

/* from manifest.ts */
/**
 * One file, handed to the generator as **data rather than as a path**. `generateManifest` imports
 * no `fs`, which is what lets the identical generator run in a browser worker holding files it
 * fetched, in CI, and behind the Node CLI that walks a checkout — a filesystem is the one thing
 * those environments do not share. Whoever calls it owns discovery; the generator owns meaning.
 *
 * `name` is load-bearing beyond identification: the entry's slug is derived from it, so the file
 * name is the entry's address within its collection.
 */
export type ContentSource = {
  /** The file's name within its collection folder, e.g. `hello-world.md`. */
  name: string;
  /** The file's full text. */
  text: string;
};

/* from query.ts — the read-side surface */
/**
 * A manifest row as a reader hands it back — stamped with the collection it came from. A manifest
 * does not repeat its own name once per row, so the reader adds it at read time, and that is what
 * lets `entries(['posts', 'notes'])` answer with one array whose rows still each say where they
 * came from.
 */
export interface ReaderEntry extends ManifestEntry {
  collection: string;
}

/**
 * What a listing page asks of a set of manifest rows: filter, then sort, then slice — in that
 * order, which is why `limit` counts matches rather than candidates. Generic over the row so a
 * caller's richer entry type survives the query instead of widening back to `ManifestEntry`.
 *
 * **The filter is a predicate function on purpose**, not a serializable `where` clause. The
 * declarative form belongs with the schema layer that can type it: a JSON query only becomes safe
 * to hand an agent once the fields it names have declared types to validate against.
 */
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
/**
 * `createReader`'s configuration — and worth reading for what is absent from it: no credentials.
 * Manifests are public static files and fetching them takes no auth at all, which is the visible
 * half of the read/write split. Tokens live on `WriterOptions`, behind an entry a deployed site
 * cannot import.
 */
export type ReaderOptions = {
  /**
   * Where manifests live, ending in `/` — `${url}${collection}.json`. Defaults to `/_manifests/`,
   * the underscore matching static-platform convention for infrastructure files. Absolute URLs
   * work too, which is how one site reads another's manifests.
   */
  url?: string;
};

/**
 * The runtime read surface over a published site's manifests, and the one thing in this package
 * that touches the network. An instance rather than free functions because a reader holds
 * instance-shaped state — the base URL and the manifest cache — and two readers on one page (a site
 * reading itself, a widget reading a friend's site) must not fight over it at module scope.
 *
 * Everything with logic in it lives in `queryEntries`, pure, so a build gets the identical
 * filter/sort/slice without pretending to fetch. A reader can only ever read: committing is a
 * different capability with a different factory, which mirrors where the credentials are.
 */
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
/**
 * The `taxonomies.json` artifact: **counts, never rows.** An archive page's rows already come out
 * of the collection manifests a reader holds (`entries('posts', { filter })`); what nothing else
 * answers cheaply is "which terms are in use, how much, and where" — the tag cloud, the nav, and
 * the empty term an archive should decline to link, which is why unused terms are present with
 * `count: 0` rather than simply absent.
 *
 * Read the maps with `Object.hasOwn`: term slugs are author-written content, so a term called
 * `constructor` must count zero instead of finding Object's own. The generator builds both levels
 * null-prototyped for that same reason.
 */
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
/**
 * `buildDom`'s single option, and it exists for the realm rule: nodes must be created by the
 * document they will live in — a popped-out window, an iframe, a jsdom in a test. Everywhere else
 * the framework derives that from the node it was handed; `buildDom` starts from an AST and has no
 * node to ask, so the caller that does know passes it.
 */
export type BuildDomOptions = {
  /** The document to create nodes with. Defaults to the global — a page, a worker shim, jsdom. */
  document?: Document;
};

/* from node.ts — the generator's CLI-facing shapes */
/**
 * Where a build reads and where it writes. `buildManifests` and `checkManifests` take the same
 * shape deliberately — a check run with different options compares the content against the wrong
 * directory and reports drift that is only disagreement about which build it is checking.
 *
 * The two defaults pair up: `_manifests` is exactly where `createReader` looks, so an unconfigured
 * build and an unconfigured reader already agree with nothing wired between them.
 */
export type BuildOptions = {
  /** The content root — one subdirectory per collection. Default `content`. */
  content?: string;
  /** Where the artifacts go. Default `_manifests`, which is where `createReader` looks. */
  out?: string;
};

/**
 * What a completed build produced. Note that there is no failure field: anything that must stop a
 * publish — a file the frontmatter parser refuses, a violated declared field, a dangling reference
 * or term — throws with the file named, so a result in hand always means the artifacts are on disk.
 *
 * Warnings are **returned rather than printed** because this is pipeline code: whether a warning
 * becomes a console line, a CI annotation or an editor banner belongs to the caller.
 */
export type BuildResult = {
  /** Every file written, `site.json` included, in written order. */
  written: string[];
  /** The generator's warnings, prefixed with nothing — presentation is the caller's. */
  warnings: string[];
};

/**
 * The drift check's verdict — all three arrays empty means the committed artifacts are exactly what
 * today's content produces. It exists because a generated artifact that gets committed and that
 * nothing verifies goes stale silently, which is the same reason the generator treats determinism
 * as a contract rather than a nicety.
 *
 * The three answer different questions, and `orphaned` is the one that is easy to forget: an
 * artifact still deployed and still answering queries for content that no longer exists.
 */
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
/**
 * `createWriter`'s configuration, and **the trust boundary of this package.** `api`, `repo` and
 * `branch` carry exactly the standing the token does: code that lets an outsider choose any of them
 * has handed over where the token gets sent. All four are caller configuration, never request input.
 *
 * How a token is *minted* — a device flow, a paste, a CI secret — is deliberately not modelled here;
 * that is the host application's concern. The writer is handed a token, or a function producing a
 * fresh one per request, which is what lets a caller keep it out of storage entirely.
 */
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

/**
 * One pending change in a writer's overlay, as `status()` reports it. **`text: null` is a removal**,
 * not an empty file — the same null that becomes a null-sha entry when the commit's tree is built.
 */
export type Staged = { path: string; text: string | null };

/**
 * The publish surface: a **staged overlay over a pinned base commit.** `open()` pins where the
 * branch head is; `stage`/`remove` accumulate locally and cost no requests at all; `publish()` lands
 * the lot as ONE commit — a blob per changed file, a delta tree so unlisted files ride through
 * untouched, and a single ref update.
 *
 * That ref update is **never forced.** If the branch moved while this session was editing, GitHub
 * refuses the fast-forward and the writer reports exactly that — with the staged overlay
 * deliberately kept, because it is local. `open()` again to re-pin and publish, and the same work
 * lands on the newer base instead of someone else's commit quietly disappearing.
 */
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

