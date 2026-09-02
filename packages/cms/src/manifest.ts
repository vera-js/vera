/**
 * The manifest generator: a collection's files in, its static index out. This is the piece that
 * lets a deployed site — and a browser reading a repo — answer "what entries exist, with what
 * metadata" from **one cached fetch** instead of one request per file, which is the wall every
 * git-backed reader eventually hits against an API rate limit.
 *
 * **Files arrive as data, never as a directory.** There is no `fs` in this file because the same
 * generator has to run everywhere a build runs — a browser worker holding files it fetched or was
 * handed, a Node CLI walking a checkout, CI — and the one thing those environments do not share is
 * a filesystem. Whoever calls this owns discovery; this owns meaning.
 *
 * **Determinism is a contract, not a nicety.** The manifest is a generated artifact that gets
 * committed, which makes it drift-checkable — same files in, same bytes out, on any machine — and
 * that only holds if nothing environment-shaped leaks in. The trap guarded here: directory
 * enumeration order varies by platform, so entries are **sorted by slug**, never trusted from the
 * caller. Row shape is fixed at construction; `data` passes through in the author's own key order,
 * which is part of the input, not the environment.
 *
 * **A broken file fails the build; a missing identity only warns.** Publish time is the one moment
 * a mistake can be caught before it deploys, so a file the frontmatter parser refuses throws —
 * with the file's name wrapped around the parser's own line-numbered message. A missing `uuid` is
 * different: content written before an identity convention existed should index, not block, so it
 * lands in `warnings`. Warnings are **returned rather than printed**: this is pipeline code, and
 * what a warning should do — a console line, an editor banner, a CI annotation — belongs to the
 * caller, not down here.
 */
import { parseContent } from './frontmatter.js';
import { CollectionSchema, validateEntry } from './schema.js';
import { Manifest, ManifestEntry } from './types.js';

/** What the generator needs to know about one file; discovery and reading are the caller's. */
export type ContentSource = {
  /** The file's name within its collection folder, e.g. `hello-world.md`. */
  name: string;
  /** The file's full text. */
  text: string;
};

/**
 * Builds one collection's manifest from its files.
 *
 * @param collection The collection's name — its folder's name
 * @param files The collection's files, in any order; order never reaches the output
 * @param spec The collection's schema, when the site has one — declared-field violations throw,
 * everything softer lands in warnings; absent, entries publish unvalidated exactly as before
 * @return The manifest, entries sorted by slug, and any warnings — returned, not printed
 */
export const generateManifest = (
  collection: string,
  files: Iterable<ContentSource>,
  spec?: CollectionSchema
): { manifest: Manifest; warnings: string[] } => {
  const entries: ManifestEntry[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const slug = file.name.replace(/\.md$/, '');
    let parsed;
    try {
      parsed = parseContent(file.text);
    } catch (error) {
      /** The parser's message carries the line; this adds which file, which it cannot know. */
      throw new Error(`generateManifest: ${collection}/${file.name}: ${(error as Error).message}`);
    }

    if (spec !== undefined) {
      const checked = validateEntry(parsed.data, spec);
      if (checked.errors.length > 0)
        throw new Error(`generateManifest: ${collection}/${file.name}: ${checked.errors.join('; ')}`);
      for (const warning of checked.warnings) warnings.push(`${collection}/${file.name} ${warning}`);
      if (spec.body === false && parsed.body.trim() !== '')
        warnings.push(`${collection}/${file.name} has a body, but the collection is data-only (body: false) — it will not render`);
    }

    const uuid = typeof parsed.data.uuid === 'string' ? parsed.data.uuid : null;
    if (uuid === null)
      warnings.push(
        `${collection}/${file.name} has no uuid, so nothing can reference it and a rename will ` +
          `orphan its history — add one to its frontmatter`
      );

    entries.push({ slug, uuid, data: parsed.data, excerpt: excerptOf(parsed.root.children) });
  }

  entries.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { manifest: { version: 1, collection, entries }, warnings };
};

/**
 * The first paragraph, as plain text — what a listing shows under a title.
 *
 * Plain text and not markup, because every consumer of an excerpt (a card, a `<meta>` description,
 * a search row) wants prose it can truncate and escape itself; handing it tags would put a
 * sanitization question inside every listing. Inline formatting flattens to its text; HTML *tags*
 * vanish while the prose between them stays, because `<mark>this</mark>` is emphasis around
 * content, not markup to discard. A body that opens with a heading or an image answers `null`
 * rather than guessing at a paragraph further down — the author leads with what they lead with.
 */
const excerptOf = (blocks: { type: string; children?: unknown }[]): string | null => {
  const first = blocks[0];
  if (first === undefined || first.type !== 'paragraph') return null;
  let text = '';
  const walk = (nodes: { type: string; value?: string; children?: unknown }[]) => {
    for (const node of nodes) {
      if (node.type === 'text' || node.type === 'inlineCode') text += node.value;
      else if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(first.children as { type: string }[]);
  /** An image-only or html-only opener flattens to nothing — that is null, not an empty string. */
  return text.trim() === '' ? null : text;
};

/**
 * The manifest as the exact bytes the artifact holds — one fixed shape, so identical input is
 * identical output on any machine, which is what lets a `--check` hold it.
 *
 * @param manifest The manifest out of `generateManifest`
 * @return Pretty-printed JSON with a trailing newline, ready to write beside the site
 */
export const serializeManifest = (manifest: Manifest): string => JSON.stringify(manifest, null, 2) + '\n';
