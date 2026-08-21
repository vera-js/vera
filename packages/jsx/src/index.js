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
import { transformJsx } from './transform.js';

export { transformJsx };

export const veraJsx = (options = {}) => ({
  name: 'vera-jsx',
  enforce: 'pre',
  transform(code, id) {
    const file = id.split('?')[0];
    if (!/\.[jt]sx$/.test(file)) return null;
    return { code: transformJsx(code, file, options), map: null };
  },
});

export default veraJsx;
