/**
 * **@verajs/cms's publishing diagnostics — schema, manifests, the build, the writer** (code-system phase 5,
 * 2026-10-09). Referenced as `__DEV__ && PROSE[…]` like every table; the entries that carry these keep `__DEV__` TRUE in
 * every build (`publish`, `node` and the cli are read by the person who fixes the error — rollup.config.js), so their
 * words ship there. One table per side: the `content` entry — a visitor's page — never imports this one.
 * `scripts/sync-diagnostics.mjs` merges it with content's into `packages/cms/diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'cms-schema-json': (detail) => [`not valid JSON — ${detail}.`, 'Fix the syntax in content/schema.json.'],
  'cms-schema-not-object': () => ['expected an object.', 'content/schema.json holds one object: { "version": 1, "collections": { … } }.'],
  'cms-schema-version': (version) => [
    `unknown version ${version} — this reader understands 1.`,
    'Set "version": 1, or update @verajs/cms to a release that reads this version.',
  ],
  'cms-schema-collections': () => ['expected a collections object.', 'Write "collections": { "posts": { … } }.'],
  'cms-schema-collection-name': (name) => [
    `${name} is not a collection name — letters, digits, _ and -, starting alphanumeric.`,
    'Rename the collection; its folder under content/ takes the same name.',
  ],
  'cms-schema-collection-shape': (at) => [`${at} must be an object.`, 'Give the collection a { "fields": { … } } object.'],
  'cms-schema-field-type': (at, types) => [`${at} needs a type from: ${types}.`, 'Give the field one of those types.'],
  'cms-schema-implicit-field': (at, name) => [
    `${at} — "${name}" is implicit and cannot be declared.`,
    'Remove it: every entry has uuid, title, body and slug already.',
  ],
  'cms-schema-field-name': (at) => [
    `${at} — not a field name: letters, digits, _ and -, starting alphanumeric.`,
    'Rename the field.',
  ],
  'cms-schema-select-options': (at) => [`${at} — a select needs a non-empty options array.`, 'List its choices: "options": ["a", "b"].'],
  'cms-schema-reference': (at) => [
    `${at} — a reference needs the collection it points into.`,
    'Name it: "collection": "authors".',
  ],
  'cms-schema-list-type': (at) => [`${at} — a list holds 'string' or 'number' items.`, 'Set "of": "string" or "of": "number".'],
  'cms-schema-taxonomy': (at) => [`${at} — a taxonomy field names its term collection.`, 'Name it: "taxonomy": "tags".'],
  'cms-schema-taxonomy-missing': (at, taxonomy) => [
    `${at} points at taxonomy ${taxonomy}, which is not a declared collection — terms are entries, so a taxonomy needs its collection.`,
    'Declare that collection, or point at one that exists.',
  ],
  'cms-manifest-entry': (where, detail) => [
    `${where} could not be read: ${detail}.`,
    "The file's own error is this one's cause; fix the file and build again.",
  ],
  'cms-manifest-invalid': (where, problems) => [`${where} has fields that do not match the schema: ${problems}.`, 'Fix those fields in the file and build again.'],
  /** One entry's lines — each a list item (a manifest's errors, the build's warnings), its subject the field or the file. */
  'cms-entry-required': () => ['this required field is missing.', 'Add it to the entry\'s frontmatter.'],
  'cms-entry-value': (expected, got) => [`expected ${expected}, got ${got}.`, 'Change the value in the entry\'s frontmatter.'],
  'cms-entry-untitled': () => ['the entry has no title, so listings will show its slug.', 'Give it a title in its frontmatter.'],
  'cms-entry-unknown-field': () => ['this field is not in the schema — it publishes, but nothing validates it.', 'Declare it in content/schema.json, or remove it.'],
  'cms-entry-body-unused': () => [
    'the entry has a body, but the collection is data-only (body: false) — it will not render.',
    'Remove the body, or allow one in the collection\'s schema.',
  ],
  'cms-entry-no-uuid': () => [
    'the entry has no uuid, so nothing can reference it and a rename will orphan its history.',
    'Add one to its frontmatter.',
  ],
  'cms-entry-dangling-reference': (field, uuid, collection) => [
    `${field} references uuid ${uuid}, and ${collection}/ has no entry carrying it.`,
    'Point it at an entry that exists, or create that entry.',
  ],
  'cms-entry-unknown-term': (field, slug, taxonomy, path) => [
    `${field} names the term ${slug}, and ${taxonomy}/ has no such entry.`,
    `Fix the slug, or create ${path}.`,
  ],
  'cms-build-unknown-collection': () => ['the collection is not in the schema — it publishes, but nothing validates it.', 'Declare it in content/schema.json.'],
  'cms-build-missing-folder': () => ['the schema declares this collection, but content/ has no such folder.', 'Create the folder, or remove the collection from the schema.'],
  'cms-build-schema': (path, detail) => [`${path} is not a usable schema: ${detail}.`, 'Fix content/schema.json and build again.'],
  'cms-build-reserved-name': (name) => [
    `a collection cannot be named ${name} — that artifact name belongs to the generated index.`,
    'Rename the collection folder.',
  ],
  'cms-build-errors': (count, list) => [`${count} problem(s) across the content:\n  ${list}`, 'Fix each and build again.'],
};
