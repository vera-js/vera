/** **`@verajs/renderer/until`'s diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'until-rejected': () => [
    'the promise given to until() rejected, so its position kept showing the fallback.',
    'Handle the rejection in the promise (`.catch(…)`), or use `resource()` from `@verajs/store/resource`, whose `error` a template can show.',
  ],
};
