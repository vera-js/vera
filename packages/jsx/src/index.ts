/**
 * @verajs/jsx — JSX/TSX for Vera, as a build plugin. Compiles JSX into the renderer's tagged
 * templates: zero runtime cost, same engine, template identity intact (one JSX call site = one
 * `html` call site; nested markup is inline statics). Buildless stays the baseline — this is the
 * opt-in for people who already run a build. React DX on web standards, not React compatibility:
 * components remain platform classes; JSX styles the templates.
 *
 *   // vite.config.js
 *   import { veraJsx } from '@verajs/jsx';
 *   export default { plugins: [veraJsx()] };
 *
 * Options: { inject: false } to skip auto-imports, { html: ['html', 'my-module'] } and
 * { keyed: ['keyed', 'my-module'] } to retarget them.
 */
import { importSites, transformJsx } from './transform.js';
import type { VeraJsxOptions } from './types.js';

export { importSites, transformJsx };
export type { VeraJsxOptions } from './types.js';

export const veraJsx = (options: VeraJsxOptions = {}) => ({
  name: 'vera-jsx',
  enforce: 'pre' as const,
  transform(this: { warn?: (message: string) => void } | void, code: string, id: string): { code: string; map: null } | null {
    const file = id.split('?')[0]!;
    if (!/\.[jt]sx$/.test(file)) return null;
    /** What compiles but is probably a mistake is reported through the bundler (Vite's `this.warn`), unless the caller took it. */
    const warn = (this as { warn?: (message: string) => void } | undefined)?.warn;
    const onWarning = options.onWarning ?? (warn === undefined ? undefined : (message: string) => warn.call(this, message));
    return { code: transformJsx(code, file, { ...options, onWarning }), map: null };
  },
});
/** The default export died in the conventions pass — jsx was the only package carrying one. */
