/**
 * The schema layer: what `content/schema.json` declares, and the validation it powers at publish.
 *
 * **Authored as a JSON file, deliberately** — not code. The schema has three writers (a person, the
 * editing tooling, an agent) and code round-trips for only one of them; a JSON file round-trips
 * for all three, works buildless, and is itself the machine-readable contract an agent reads to
 * author valid content. TypeScript types are *generated from* it, not the other way around, so the
 * hand-authoring DX code-first schemas are famous for arrives via codegen instead of `eval`.
 *
 * **Every collection implicitly carries three fields**, because everything human-facing has them:
 * `uuid` (identity — references key on it; missing warns, never blocks, never opts out), `title`
 * (the human label; missing warns; `title: false` for label-less collections like redirects), and
 * the markdown `body` (`body: false` for data-only collections like navigation). Deliberately NOT
 * implicit: `date` — posts want one, pages do not, so it stays declared. `slug` is derived from
 * the file name and is never declared.
 *
 * **Strictness is graded, and the grades are the design:**
 *   - a field the schema *declares* that a file violates — wrong type, missing required, unknown
 *     select option — **fails the publish**: a declaration is a promise, and publish time is the
 *     one moment a broken promise can be caught before it deploys;
 *   - a field the schema *does not know* only **warns**: hand-edited files and mid-migration
 *     content carry harmless extras, and blocking a whole site over one stray key punishes the
 *     wrong person;
 *   - the implicit fields **warn** when absent — an entry without a title lists by its slug, which
 *     is degraded, not broken.
 *
 * The validator is a subset by the same reasoning as the markdown and frontmatter parsers: a
 * handful of field types cover real content models, the shapes here are what the tooling writes,
 * and anything the subset cannot say fails loudly at schema load rather than validating wrongly.
 */
import { FrontmatterMap, FrontmatterValue } from './types.js';

/** The field vocabulary. `text` is multiline prose; `string` is a line. */
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

const FIELD_TYPES = new Set(['string', 'text', 'number', 'boolean', 'date', 'image', 'select', 'reference', 'list', 'taxonomy']);
/**
 * What a collection or field may be called. The pattern bounds every place these names travel —
 * artifact paths (`join(out, name + '.json')`), fetch URLs, generated-schema property keys — so a
 * name can never be a traversal (`../evil`) or a URL segment with opinions. Of the reserved
 * words, two were measured breaking things before the rule existed — `__proto__` assignment
 * replaces a prototype instead of creating a key, and a `constructor` lookup found Object's own
 * instead of `undefined` and crashed a build — and `prototype` rides along as the third of the
 * classic trio, reserved defensively. `site` and `taxonomies` are the generated artifacts' names.
 */
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const RESERVED = new Set([
  '__proto__', 'constructor', 'prototype',
  /** Generated-artifact names: a collection called `site` would lose its manifest to the site index. */
  'site', 'taxonomies',
]);
const badName = (name: string): boolean => !NAME.test(name) || RESERVED.has(name);
/**
 * A calendar date, optionally with a time — with real ranges: `2026-13-99` validated clean when
 * this only counted digits (audit pass 8). Month 01–12, day 01–31 (day-per-month is beyond a
 * regex's pay grade), hour 00–23, minute/second 00–59. Always a string (see frontmatter.ts), and
 * `emit.ts` publishes this exact pattern — a test pushes the same accept/reject samples through
 * both and fails if they ever disagree.
 */
const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])([T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?)?$/;

/**
 * Parses and validates the schema file itself — a schema that is wrong must fail at load, with the
 * path named, not validate content wrongly.
 *
 * @param text The contents of `content/schema.json`
 * @return The schema, checked shape-by-shape
 */
export const parseSchema = (text: string): Schema => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`parseSchema: not valid JSON — ${(error as Error).message}`);
  }
  const schema = raw as Schema;
  if (schema === null || typeof schema !== 'object') throw new Error('parseSchema: expected an object');
  if (schema.version !== 1) throw new Error(`parseSchema: unknown version ${JSON.stringify(schema.version)} — this reader understands 1`);
  if (schema.collections === null || typeof schema.collections !== 'object')
    throw new Error('parseSchema: expected a collections object');

  for (const [collection, spec] of Object.entries(schema.collections)) {
    const at = `collections.${collection}`;
    if (badName(collection))
      throw new Error(`parseSchema: ${JSON.stringify(collection)} is not a collection name — letters, digits, _ and -, starting alphanumeric`);
    if (spec === null || typeof spec !== 'object') throw new Error(`parseSchema: ${at} must be an object`);
    for (const [name, field] of Object.entries(spec.fields ?? {})) {
      const here = `${at}.fields.${name}`;
      if (field === null || typeof field !== 'object' || !FIELD_TYPES.has(field.type))
        throw new Error(`parseSchema: ${here} needs a type from: ${[...FIELD_TYPES].join(', ')}`);
      if (name === 'uuid' || name === 'title' || name === 'body' || name === 'slug')
        throw new Error(`parseSchema: ${here} — "${name}" is implicit and cannot be declared`);
      if (badName(name))
        throw new Error(`parseSchema: ${here} — not a field name: letters, digits, _ and -, starting alphanumeric`);
      if (field.type === 'select' && (!Array.isArray(field.options) || field.options.length === 0))
        throw new Error(`parseSchema: ${here} — a select needs a non-empty options array`);
      if (field.type === 'reference' && (typeof field.collection !== 'string' || badName(field.collection)))
        throw new Error(`parseSchema: ${here} — a reference needs the collection it points into`);
      if (field.type === 'list' && field.of !== 'string' && field.of !== 'number')
        throw new Error(`parseSchema: ${here} — a list holds 'string' or 'number' items`);
      /**
       * The VALUE is checked like a name, because it is one — `taxonomy: "__proto__"` walked
       * through the inherited-lookup existence check below and seeded terms onto
       * `Object.prototype` itself, globally, with the build reporting green (audit pass 7).
       */
      if (field.type === 'taxonomy' && (typeof field.taxonomy !== 'string' || badName(field.taxonomy)))
        throw new Error(`parseSchema: ${here} — a taxonomy field names its term collection`);
      if (field.type === 'taxonomy' && !Object.hasOwn(schema.collections, field.taxonomy))
        throw new Error(
          `parseSchema: ${here} points at taxonomy "${field.taxonomy}", which is not a declared collection — ` +
            `terms are entries, so a taxonomy needs its collection`
        );
    }
  }
  return schema;
};

/** One value against one declared field; a sentence when it breaks the promise, null when it keeps it. */
const violation = (value: FrontmatterValue, field: Field): string | null => {
  switch (field.type) {
    case 'string':
    case 'text':
    case 'image':
      return typeof value === 'string' ? null : `expected a string, got ${describe(value)}`;
    case 'number':
      return typeof value === 'number' ? null : `expected a number, got ${describe(value)}`;
    case 'boolean':
      return typeof value === 'boolean' ? null : `expected a boolean, got ${describe(value)}`;
    case 'date':
      return typeof value === 'string' && DATE.test(value)
        ? null
        : `expected a date like 2026-09-02, got ${describe(value)}`;
    case 'select':
      return typeof value === 'string' && field.options.includes(value)
        ? null
        : `expected one of ${field.options.join(', ')} — got ${describe(value)}`;
    case 'reference':
      return typeof value === 'string' ? null : `expected the uuid of an entry in "${field.collection}", got ${describe(value)}`;
    case 'taxonomy':
      return Array.isArray(value) && value.every((item) => typeof item === 'string')
        ? null
        : `expected a list of "${field.taxonomy}" term slugs, got ${describe(value)}`;
    case 'list':
      return Array.isArray(value) && value.every((item) => typeof item === field.of)
        ? null
        : `expected a list of ${field.of}s, got ${describe(value)}`;
  }
};

const describe = (value: FrontmatterValue): string =>
  value === null ? 'null' : Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'a map' : JSON.stringify(value);

/**
 * One entry's frontmatter against its collection's schema.
 *
 * @param data The parsed frontmatter fields
 * @param spec The collection's schema; the implicit fields are checked whether or not it declares anything
 * @return Errors that must fail the publish, and warnings that must not
 */
export const validateEntry = (data: FrontmatterMap, spec: CollectionSchema): Validation => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const fields = spec.fields ?? {};

  for (const [name, field] of Object.entries(fields)) {
    const value = data[name];
    if (value === undefined || value === null) {
      if (field.required) errors.push(`"${name}" is required and missing`);
      continue;
    }
    const broken = violation(value, field);
    if (broken !== null) errors.push(`"${name}": ${broken}`);
  }

  if (spec.title !== false && typeof data.title !== 'string')
    warnings.push('has no title, so listings will show its slug');

  for (const name of Object.keys(data)) {
    if (name === 'uuid' || name === 'title') continue;
    /** `hasOwn`, not an undefined-check: a field named `constructor` must read as unknown, not as inherited machinery. */
    if (!Object.hasOwn(fields, name))
      warnings.push(`"${name}" is not in the schema — it publishes, but nothing validates it`);
  }

  return { errors, warnings };
};
