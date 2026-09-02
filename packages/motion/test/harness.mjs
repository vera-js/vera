/**
 * `node:test`'s runner functions with Vitest's `.each` attached — the one
 * runner idiom the suite uses that `node:test` does not have. 36 call sites
 * across 13 files parameterize this way; wrapping here keeps them all
 * byte-identical instead of unrolling each into a loop.
 *
 * `%s`/`%d`/`%i`/`%f`/`%j`/`%o` consume arguments in order, `%#` is the case
 * index, `%%` a literal percent — the subset the suite's titles actually use.
 */
import { describe as _describe, it as _it, test as _test, beforeEach, afterEach, before, after } from 'node:test';

const formatTitle = (title, args, index) => {
  let at = 0;
  return title.replace(/%[sdifjo#%]/g, (token) => {
    if (token === '%%') return '%';
    if (token === '%#') return String(index);
    const value = args[at++];
    if (token === '%j' || token === '%o') {
      try {
        return JSON.stringify(value) ?? String(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  });
};

const withEach = (runner) => {
  const wrapped = (...args) => runner(...args);
  wrapped.each = (cases) => (title, body) => {
    cases.forEach((c, index) => {
      const args = Array.isArray(c) ? c : [c];
      runner(formatTitle(title, args, index), () => body(...args));
    });
  };
  wrapped.skip = runner.skip?.bind(runner);
  wrapped.only = runner.only?.bind(runner);
  wrapped.todo = runner.todo?.bind(runner);
  return wrapped;
};

export const describe = withEach(_describe);
export const it = withEach(_it);
export const test = withEach(_test);
export { beforeEach, afterEach, before, after };
