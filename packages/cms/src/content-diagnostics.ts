/**
 * **@verajs/cms's content-side diagnostics — frontmatter, markdown, the reader** (code-system phase 5b, 2026-10-09).
 * `content` is a VISITOR's page bundle: these words are development's, referenced `__DEV__ && PROSE[…]`, so its
 * production bundle prints `<where>: https://verajs.dev/e/<code>`; a Node consumer reads them through the `node` export
 * condition's build, and `publish` (which shares frontmatter and markdown) keeps them in every build. Frontmatter's
 * fourteen refusals are seven facts (vera-5a): one code each, the line as the subject.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'cms-frontmatter-unclosed': (what) => [`${what} never closes.`, 'Close it: a quoted string with its quote, the frontmatter with a --- line.'],
  'cms-frontmatter-unsupported': (feature, instead) => [`${feature} are not supported.`, `${instead}.`],
  'cms-frontmatter-indent': (indent) => [`expected ${indent}-space indentation.`, 'Indent each level by two spaces.'],
  'cms-frontmatter-entry': (expected) => [`expected ${expected}.`, 'Write one entry per line.'],
  'cms-frontmatter-key': (key, why) => [`the key ${key} ${why}.`, 'Rename or remove the key.'],
  'cms-frontmatter-mixed-list': () => ['a list mixes scalar and map items.', 'Use one or the other.'],
  'cms-frontmatter-depth': (max) => [`nesting deeper than ${max} levels.`, 'Flatten the data: frontmatter holds fields, not documents.'],
  'cms-markdown-depth': (max) => [`nesting deeper than ${max} levels — this is not prose.`, 'Flatten the lists or quotes.'],
  /** The address and the HTTP status are each line's SUBJECT (production keeps them): these say what it was. */
  'cms-reader-manifest': (collection) => [
    `could not load the ${collection} manifest.`,
    'Check the manifests were built and deployed at that address.',
  ],
  'cms-reader-taxonomy': () => [
    'could not load the taxonomy index.',
    'Check taxonomies.json was built and deployed beside the manifests.',
  ],
};
