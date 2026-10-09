/**
 * **`@verajs/autoloader`'s diagnostics — DEVELOPMENT ONLY prose.** Two loaders live here — `autoloader` (components) and
 * `directiveLoader` (directives) — and where they say one fact it is ONE code (the loader is the line's area). Published
 * as `packages/autoloader/diagnostics.json`.
 */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'loader-root-required': () => ['rootDir is required — the directory every path resolves against.', 'Pass import.meta.url.'],
  'loader-root-not-absolute': (rootDir) => [
    `rootDir must be an absolute URL, and "${rootDir}" is not.`,
    'Pass import.meta.url — a relative path has nothing to resolve against.',
  ],
  'loader-option': (key, known) => [`\`${key}\` is not an option, so it was ignored.`, `The options are ${known}.`],
  /** Three reasons, one fact — a URL this loader will not fetch (and no request is made). */
  /** The refused URL is the line's SUBJECT, so production — which prints no prose — still says which. */
  'loader-url-refused': (why) => [`refused — ${why}.`, 'Nothing was requested. Point the directory, or `resolve`, at a path inside rootDir.'],
  /** What it threw is the SUBJECT (printed in every build); this explains it. */
  'loader-resolve-threw': () => [
    'the `resolve` option threw.',
    'The element was left unloaded; `resolve(name, dir)` must return a path and never throw.',
  ],
  'loader-import-failed': (what, src) => [`failed to load ${what} from ${src}.`, 'The error is printed beside this line; the import itself failed.'],
  'autoloader-not-defined': (tag) => [
    `the module loaded but nothing defined <${tag}>.`,
    'Check the tag name in that file matches the one in the markup, and that its `customElements.define` actually runs.',
  ],
  'directive-loader-name': (name) => [`"${name}" is not a directive name this will resolve.`, 'A directive name is lowercase letters, digits and dashes, starting with a letter.'],
};
