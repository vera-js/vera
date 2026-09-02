/**
 * The cross-collection half of taxonomies: the checks and the artifact that no single file's
 * validation can produce, because they need every manifest at once.
 *
 * **Referential integrity, at build time — which is the better time.** A database catches a
 * dangling reference when someone saves; this catches it before anything deploys, in whatever
 * gate runs the publish, with the file and the bad slug named. A typo'd term (`desing`) is a
 * broken promise against a declared field, so it is an error, not a warning — and the fix is one
 * of two honest moves: correct the slug, or create the term, which is a content file like any
 * other because terms ARE entries.
 *
 * **The artifact, `taxonomies.json`, carries counts, not rows.** An archive page's rows come from
 * the collection manifests the reader already has (`entries('posts', { filter })`); what nothing
 * else can answer cheaply is "which terms are in use, how much, where" — the tag cloud, the nav,
 * the empty-term archive that should not render a link. Counts per term per collection, sorted
 * everywhere, so the artifact is as deterministic as every other one.
 *
 * Pure on purpose, like the generator: manifests in, result out — the browser worker and the Node
 * CLI run the identical integrity check, so a site publishes to the same standard from either.
 */
import { CollectionSchema, Schema } from './schema.js';
import { Manifest } from './types.js';

export type TaxonomyIndex = {
  version: 1;
  /** taxonomy -> term slug -> where it is used. Terms nobody uses appear with count 0. */
  taxonomies: {
    [taxonomy: string]: {
      [term: string]: { count: number; collections: { [collection: string]: number } };
    };
  };
};

/** The taxonomy fields a collection declares, as `[fieldName, termCollection]` pairs. */
const taxonomyFieldsOf = (spec: CollectionSchema): [string, string][] =>
  Object.entries(spec.fields ?? {}).flatMap(([name, field]) =>
    field.type === 'taxonomy' ? [[name, field.taxonomy] as [string, string]] : []
  );

/**
 * Reference integrity, the same standard by the same mechanism: a `reference` field holds the
 * UUID of an entry in its target collection, and a UUID nothing answers to is an error before
 * anything deploys. UUIDs rather than slugs on purpose — a reference must survive the rename that
 * D19's identity rule exists for; a slug reference would re-create the fragility the UUID removed.
 *
 * @param schema The site's schema — it says which fields are references and into what
 * @param manifests Every collection's manifest, keyed by collection name
 * @return The dangling references, as errors the publish must fail on
 */
export const checkReferences = (schema: Schema, manifests: Map<string, Manifest>): string[] => {
  const errors: string[] = [];
  /** uuid -> slug per target collection, built once per collection that anything points into. */
  const indexes = new Map<string, Map<string, string>>();
  const indexOf = (collection: string): Map<string, string> => {
    let index = indexes.get(collection);
    if (index === undefined) {
      index = new Map();
      for (const entry of manifests.get(collection)?.entries ?? [])
        if (entry.uuid !== null) index.set(entry.uuid, entry.slug);
      indexes.set(collection, index);
    }
    return index;
  };

  for (const [collection, spec] of Object.entries(schema.collections)) {
    const manifest = manifests.get(collection);
    if (manifest === undefined) continue;
    for (const [fieldName, field] of Object.entries(spec.fields ?? {})) {
      if (field.type !== 'reference') continue;
      for (const entry of manifest.entries) {
        const value = entry.data[fieldName];
        if (typeof value !== 'string') continue; // absent or invalid; per-entry validation owns that
        if (!indexOf(field.collection).has(value))
          errors.push(
            `${collection}/${entry.slug}.md: "${fieldName}" references uuid "${value}", and ` +
              `${field.collection}/ has no entry carrying it`
          );
      }
    }
  }
  return errors;
};

/**
 * Checks every taxonomy reference and builds the usage index.
 *
 * @param schema The site's schema — it says which fields are taxonomies
 * @param manifests Every collection's manifest, keyed by collection name
 * @return The index artifact, and the dangling references as errors the publish must fail on
 */
export const generateTaxonomies = (
  schema: Schema,
  manifests: Map<string, Manifest>
): { index: TaxonomyIndex; errors: string[] } => {
  const errors: string[] = [];
  /** Null-prototype at BOTH levels — the outer literal was the half the first fix missed. */
  const taxonomies: TaxonomyIndex['taxonomies'] = Object.create(null);

  /** Every term collection any field points at seeds its index — unused terms count 0. */
  for (const spec of Object.values(schema.collections))
    for (const [, taxonomy] of taxonomyFieldsOf(spec)) {
      /**
       * Null-prototype, because term slugs index into this and a slug is content: a tag genuinely
       * named `constructor` must resolve as a term (or a dangling error), never as inherited
       * object machinery — the plain-object version crashed on exactly that slug.
       */
      taxonomies[taxonomy] ??= Object.create(null);
      for (const term of manifests.get(taxonomy)?.entries ?? [])
        taxonomies[taxonomy][term.slug] ??= { count: 0, collections: {} };
    }

  for (const [collection, spec] of Object.entries(schema.collections)) {
    const manifest = manifests.get(collection);
    if (manifest === undefined) continue;
    for (const [fieldName, taxonomy] of taxonomyFieldsOf(spec)) {
      const known = taxonomies[taxonomy];
      for (const entry of manifest.entries) {
        const slugs = entry.data[fieldName];
        if (!Array.isArray(slugs)) continue; // absent or invalid; per-entry validation owns that
        for (const slug of slugs) {
          if (typeof slug !== 'string') continue;
          const term = known[slug];
          if (term === undefined) {
            errors.push(
              `${collection}/${entry.slug}.md: "${fieldName}" names the term "${slug}", and ` +
                `${taxonomy}/ has no such entry — fix the slug, or create ${taxonomy}/${slug}.md`
            );
            continue;
          }
          term.count += 1;
          term.collections[collection] = (term.collections[collection] ?? 0) + 1;
        }
      }
    }
  }

  return { index: { version: 1, taxonomies: sorted(taxonomies) }, errors };
};

/** Key order is part of the bytes, and the bytes are drift-checked — so every level sorts. */
const sorted = (taxonomies: TaxonomyIndex['taxonomies']): TaxonomyIndex['taxonomies'] =>
  Object.fromEntries(
    Object.keys(taxonomies)
      .sort()
      .map((taxonomy) => [
        taxonomy,
        Object.fromEntries(
          Object.keys(taxonomies[taxonomy])
            .sort()
            .map((term) => [
              term,
              {
                count: taxonomies[taxonomy][term].count,
                collections: Object.fromEntries(
                  Object.entries(taxonomies[taxonomy][term].collections).sort(([a], [b]) => (a < b ? -1 : 1))
                ),
              },
            ])
        ),
      ])
  );

/**
 * The index as the exact bytes the artifact holds — the same contract `serializeManifest` keeps.
 *
 * @param index The index out of `generateTaxonomies`
 * @return Pretty-printed JSON with a trailing newline
 */
export const serializeTaxonomies = (index: TaxonomyIndex): string => JSON.stringify(index, null, 2) + '\n';
