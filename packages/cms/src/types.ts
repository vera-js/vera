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
