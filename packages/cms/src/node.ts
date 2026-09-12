/**
 * The Node face of the publish pipeline: the filesystem discovery the core deliberately does not
 * have. `generateManifest` takes files as data so it can run anywhere; this is the "anywhere" that
 * has a disk — a checkout on a laptop, CI, a build server. It walks `content/`, hands each
 * collection's files to the generator, and writes the artifacts a site serves.
 *
 * Two artifacts per build: one manifest per collection, and **`site.json`** — the index of
 * collections themselves, which is what lets a reader ask for "every collection" without guessing
 * at folder names it cannot see over HTTP.
 *
 * `check` exists because a committed generated artifact that nothing verifies is how this gets
 * stale silently — the same manifest built from the same content must already be on disk, byte for
 * byte, or the caller finds out. Both functions return results rather than printing or exiting;
 * what a warning or a stale file should *do* belongs to the CLI (or whatever else calls this).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateManifest, serializeManifest } from './manifest.js';
import { parseSchema } from './schema.js';
import { checkReferences, generateTaxonomies, serializeTaxonomies } from './taxonomy.js';
import { emitJsonSchemas } from './emit.js';
import type { BuildOptions, BuildResult, CheckResult, ContentSource, Manifest, Schema } from './types.js';

/**
 * One collection's files, read off disk in sorted order.
 *
 * Sorted not for the manifest — the generator orders its own output — but for the *warnings*,
 * which surface in file order and would otherwise shuffle per platform.
 */
const filesOf = (dir: string): ContentSource[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8') }));

/** Collection folders: every visible subdirectory of the content root, sorted. */
const collectionsOf = (content: string): string[] =>
  readdirSync(content, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();

/**
 * The site's schema, when `content/schema.json` exists. Absent is fine — a schemaless site
 * publishes unvalidated, exactly as before schemas existed. A schema that is *present and wrong*
 * throws with the path named: silently ignoring a broken schema would publish exactly the
 * unvalidated content its author wrote it to prevent.
 */
const schemaOf = (content: string): Schema | undefined => {
  let text;
  try {
    text = readFileSync(join(content, 'schema.json'), 'utf8');
  } catch {
    return undefined;
  }
  try {
    return parseSchema(text);
  } catch (error) {
    throw new Error(`buildManifests: ${join(content, 'schema.json')}: ${(error as Error).message}`);
  }
};

/** What a build would produce, as `path -> bytes` — shared verbatim by build and check. */
const artifactsOf = (options: BuildOptions): { artifacts: Map<string, string>; warnings: string[] } => {
  const content = options.content ?? 'content';
  const out = options.out ?? '_manifests';
  const artifacts = new Map<string, string>();
  const warnings: string[] = [];
  const schema = schemaOf(content);

  const names = collectionsOf(content);
  /** Schemaless sites get the same protection the schema's RESERVED list gives declared ones. */
  for (const name of names)
    if (name === 'site' || name === 'taxonomies')
      throw new Error(
        `buildManifests: a collection cannot be named "${name}" — that artifact name belongs to the generated index`
      );
  const manifests = new Map<string, Manifest>();
  for (const name of names) {
    /** Own keys only — a folder named `constructor` once validated against Object's constructor. */
    const spec = schema !== undefined && Object.hasOwn(schema.collections, name) ? schema.collections[name] : undefined;
    if (schema !== undefined && spec === undefined)
      warnings.push(`the "${name}" collection is not in the schema — it publishes, but nothing validates it`);
    const generated = generateManifest(name, filesOf(join(content, name)), spec);
    manifests.set(name, generated.manifest);
    artifacts.set(join(out, `${name}.json`), serializeManifest(generated.manifest));
    warnings.push(...generated.warnings);
  }

  /**
   * The cross-collection pass: dangling term references fail the build exactly as a violated
   * field does — they ARE one, just provable only with every manifest in hand.
   */
  if (schema !== undefined) {
    const { index, errors } = generateTaxonomies(schema, manifests);
    errors.push(...checkReferences(schema, manifests));
    if (errors.length > 0) throw new Error(`buildManifests:\n  ${errors.join('\n  ')}`);
    if (Object.keys(index.taxonomies).length > 0)
      artifacts.set(join(out, 'taxonomies.json'), serializeTaxonomies(index));
    /** The interchange contracts, served beside the manifests they govern. */
    for (const [name, text] of emitJsonSchemas(schema))
      artifacts.set(join(out, `${name}.schema.json`), text);
  }
  /** The reverse mismatch is usually a typo'd folder name, and a typo deserves a sentence. */
  if (schema !== undefined)
    for (const declared of Object.keys(schema.collections))
      if (!names.includes(declared))
        warnings.push(`the schema declares "${declared}", but content/ has no such folder`);

  const site = {
    version: 1,
    collections: names.map((name) => ({ name, count: manifests.get(name)!.entries.length })),
  };
  artifacts.set(join(out, 'site.json'), JSON.stringify(site, null, 2) + '\n');
  return { artifacts, warnings };
};

/**
 * Builds every collection's manifest plus the site index, writing them under `out`.
 *
 * @param options The content root and output directory; defaults fit the repo convention
 * @return What was written and what the generator warned about
 */
export const buildManifests = (options: BuildOptions = {}): BuildResult => {
  const { artifacts, warnings } = artifactsOf(options);
  mkdirSync(options.out ?? '_manifests', { recursive: true });
  for (const [path, text] of artifacts) writeFileSync(path, text);
  return { written: [...artifacts.keys()], warnings };
};

/**
 * Verifies the artifacts on disk are exactly what the content produces — the drift check.
 *
 * @param options The same options the build ran with
 * @return Which artifacts are stale, missing, or orphaned; all three empty means the disk is current
 */
export const checkManifests = (options: BuildOptions = {}): CheckResult => {
  const out = options.out ?? '_manifests';
  const { artifacts } = artifactsOf(options);
  const stale: string[] = [];
  const missing: string[] = [];
  for (const [path, expected] of artifacts) {
    let actual;
    try {
      actual = readFileSync(path, 'utf8');
    } catch {
      missing.push(path);
      continue;
    }
    if (actual !== expected) stale.push(path);
  }

  /** The other direction: .json files a build would no longer write have no business being served. */
  const orphaned: string[] = [];
  let onDisk: string[] = [];
  try {
    onDisk = readdirSync(out).filter((name) => name.endsWith('.json'));
  } catch {
    /* no out directory at all — every artifact is already in `missing` */
  }
  for (const name of onDisk) if (!artifacts.has(join(out, name))) orphaned.push(join(out, name));

  return { stale, missing, orphaned };
};
