import { diagnostic, misuse, SHARED } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/**
 * **The checks both loaders make on their entry, in one home** (`autoloader` and `directiveLoader` each held a copy):
 * the root is required and absolute, an unknown option warns, and the extension is normalized. Answers the directory
 * every URL must stay inside, and the extension.
 *
 * A configuration error fails at the misconfiguration, not once per element per render.
 *
 * A **relative** `rootDir` throws either way; development says why. The platform's own message (`Failed to construct
 * 'URL': Invalid base URL`) names neither the argument nor the fix. The value has to be absolute because every URL
 * resolves against it, which is why `import.meta.url` is the documented answer.
 *
 * An option a loader does not have does nothing, and did so in silence: `extensions` or `resolver` reads exactly like
 * the real thing at a glance, and the symptom is the *default* behavior, which looks like the option was never needed
 * rather than never seen.
 *
 * Both of those are `__DEV__`-only, so a production bundle carries neither the checks nor their text.
 *
 * @param owner The loader's name, the area every line it prints is filed under
 * @param known The option names that loader reads
 * @return `[base, extension]`: `base` is `new URL('.', rootDir)`, which always ends in `/`, so a prefix test against it
 * cannot be satisfied by a sibling directory whose name merely starts the same way. Every resolved URL must stay inside
 * it: the per-element directory override is free text, and CODE-PRINCIPLES #8 requires bounding anything that turns
 * markup into a module URL. The extension may be given as `ts` or `.ts`.
 */
export const entry = (
  owner: string,
  rootDir: string,
  options: { readonly extension?: string } | undefined,
  known: readonly string[]
): [base: string, extension: string] => {
  if (!rootDir) throw new Error(misuse(owner, 'loader-root-required', __DEV__ && PROSE['loader-root-required']()));
  if (__DEV__) {
    try {
      new URL('.', rootDir);
    } catch {
      throw new Error(misuse(owner, 'loader-root-not-absolute', __DEV__ && PROSE['loader-root-not-absolute'](rootDir)));
    }
    if (options)
      for (const key of Object.keys(options))
        if (!known.includes(key))
          console.warn(diagnostic(owner, 'options', 'unknown-option', __DEV__ && SHARED.unknownOption(key, known.join(', '))));
  }
  return [new URL('.', rootDir).href, `.${(options?.extension ?? '.js').replace(/^\./, '')}`];
};
