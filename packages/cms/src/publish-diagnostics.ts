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
  'cms-build-schema': (path, detail) => [`${path} is not a usable schema: ${detail}.`, 'Fix content/schema.json and build again.'],
  'cms-build-reserved-name': (name) => [
    `a collection cannot be named ${name} — that artifact name belongs to the generated index.`,
    'Rename the collection folder.',
  ],
  'cms-build-errors': (count, list) => [`${count} problem(s) across the content:\n  ${list}`, 'Fix each and build again.'],
};
