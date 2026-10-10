/**
 * **A jsx compile refusal (or warning), as the build under test prints it** (3d, 2026-10-09). Development and the node
 * build — what Vite and Node run — say `<position> — <words> … (<code>)`; the production compiler, the one a buildless
 * page fetches, says `<position> — https://verajs.dev/e/<code>` and no words. So a suite pins WHAT is refused and WHERE
 * in every build, and the words wherever the words exist. `position` may be left out when a pin does not name one.
 */
import { isProduction } from './dist.mjs';

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const jsxLine = (code, words, position = '') => {
  const at = position ? `${escape(position)} — ` : '';
  return isProduction
    ? new RegExp(`${at}https://verajs\\.dev/e/${code}$`)
    : new RegExp(`${at}${escape(words)}[\\s\\S]*\\(${code}\\)$`);
};
