/**
 * The interchange artifact: each collection's frontmatter contract, emitted as standard JSON
 * Schema (2020-12). `content/schema.json` is the *authoring* format — compact, ours, written by
 * people and tooling; this is what everything else reads: an agent fetching the contract before it
 * writes, an editor wiring `$schema` autocomplete for JSON data, any validator in any language.
 * Emitting the standard instead of asking the world to learn ours is the whole point.
 *
 * The mapping mirrors the graded strictness exactly, because a contract that overstates is worse
 * than none: only `required: true` fields appear in `required` (the implicit `uuid`/`title` WARN
 * when missing, and a schema that called them required would reject content the publish accepts);
 * `additionalProperties` stays `true` (unknown fields warn, they do not fail). What the standard
 * cannot say natively rides in `x-vera-*` annotations — which field type authored a property, what
 * a reference points into — marked vendor extensions, ignorable by anything that does not care.
 *
 * The body is not here: this is the frontmatter's schema, and the body is markdown, not a field.
 */
import { CollectionSchema, Field, Schema } from './schema.js';

/**
 * One property's JSON Schema, from one declared field.
 *
 * **An optional field admits null**, because the publish does: a bare `author:` line parses to
 * null and `validateEntry` counts null as missing — legal for anything not `required`. JSON
 * Schema's `required` governs only *presence*, so a present null still meets the type check, and
 * the first version of this rejected exactly the content the publish accepts (found by the final
 * fresh-eyes review, proven with a real validator). Required fields stay strict — the publish
 * refuses their null as "required and missing", so the contract may too.
 */
const property = (field: Field): Record<string, unknown> => {
  const type = (name: string): string | string[] => (field.required === true ? name : [name, 'null']);
  switch (field.type) {
    case 'string':
    case 'text':
    case 'image':
      return { type: type('string'), 'x-vera-type': field.type };
    case 'number':
      return { type: type('number') };
    case 'boolean':
      return { type: type('boolean') };
    case 'date':
      /** The exact contract the validator enforces — a `format` could not carry the date-or-datetime union. A pattern binds only strings, so an admitted null passes it. */
      return { type: type('string'), pattern: '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])([T ]([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?)?$', 'x-vera-type': 'date' };
    case 'select':
      return { enum: field.required === true ? field.options : [...field.options, null] };
    case 'reference':
      return { type: type('string'), 'x-vera-type': 'reference', 'x-vera-collection': field.collection };
    case 'list':
      return { type: type('array'), items: { type: field.of } };
    case 'taxonomy':
      return { type: type('array'), items: { type: 'string' }, 'x-vera-type': 'taxonomy', 'x-vera-taxonomy': field.taxonomy };
  }
};

/**
 * One collection's frontmatter contract as a standard JSON Schema document.
 *
 * @param collection The collection's name, carried into the document's title
 * @param spec Its authored schema
 * @return A draft 2020-12 document, deterministic for the same input
 */
export const emitJsonSchema = (collection: string, spec: CollectionSchema): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    uuid: { type: 'string', description: 'Stable identity, never derived from the path — references key on it.' },
  };
  if (spec.title !== false) properties.title = { type: 'string' };
  for (const [name, field] of Object.entries(spec.fields ?? {}).sort(([a], [b]) => (a < b ? -1 : 1)))
    properties[name] = property(field);

  const required = Object.entries(spec.fields ?? {})
    .filter(([, field]) => field.required === true)
    .map(([name]) => name)
    .sort();

  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: collection,
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    /** Unknown fields WARN at publish; a schema that rejected them would overstate the contract. */
    additionalProperties: true,
  };
};

/**
 * Every collection's contract, as `name -> serialized document` — the artifacts the build writes.
 *
 * @param schema The authored site schema
 * @return File contents keyed by collection, each deterministic bytes with a trailing newline
 */
export const emitJsonSchemas = (schema: Schema): Map<string, string> =>
  new Map(
    Object.keys(schema.collections)
      .sort()
      .map((name) => [name, JSON.stringify(emitJsonSchema(name, schema.collections[name]), null, 2) + '\n'])
  );
