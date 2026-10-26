/**
 * **`@verajs/hot/vite` — the Vite adapter** (2026-10-25): in `vite dev`, a save re-runs the component module, its second
 * `define` swaps the live elements in place (`@verajs/hot`, which the app wires FIRST in its entry), and the page keeps
 * its state. Development only (`apply: 'serve'`), Node-side only (its export is the `node` condition), and a plain object:
 * it imports nothing, `vite` included.
 *
 * - **Which modules.** One that CALLS `define(` or `customElements.define(` (comments ignored; `redefine(`,
 *   `defineProperty(` and `x.define(` are not calls to it). A define reached another way — an alias, a helper in another
 *   module — is not seen, and that module simply reloads as Vite would: never a wrong swap.
 * - **Only when its exports are components** (vera-5a). `import.meta.hot.accept()` re-runs a module while its IMPORTERS
 *   keep the old module's exports, so a component module that also exported a store would leave two stores diverging
 *   silently. It is accepted only when it exports nothing, or only what `define` returns (`export const XCard =
 *   define(…)`, `export default define(…)`) or a class; any other export lets Vite propagate the update as it would.
 * - **Stores declared in the SAME file** are made again when it re-runs. A store shared beyond one save belongs in its own
 *   module, which re-runs only when it changes.
 */
type Plugin = { name: string; apply: 'serve'; transform: (code: string, id: string) => { code: string; map: null } | null };

const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;
const COMMENTS = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g;
/** A call to `define(` or `customElements.define(` — not a member call (`x.define`), not part of a longer name. */
const DEFINE = /(?:^|[^\w$.])(?:customElements\s*\.\s*)?define\s*\(/;
const EXPORT = /(?:^|[^\w$.])export\b/g;
/** The exports a swap can take: what `define` returns, or a class. */
const COMPONENT_EXPORT = /^export\s+(?:(?:const|let|var)\s+[\w$]+\s*=\s*(?:customElements\s*\.\s*)?define\s*\(|default\s+(?:customElements\s*\.\s*)?define\s*\(|(?:default\s+)?class\b)/;

/** Whether a module's source is one a save may swap in place. */
export const swappable = (code: string): boolean => {
  const bare = code.replace(COMMENTS, '');
  if (!DEFINE.test(bare)) return false;
  for (const m of bare.matchAll(EXPORT)) {
    const at = m.index + m[0].indexOf('export');
    if (!COMPONENT_EXPORT.test(bare.slice(at))) return false;
  }
  return true;
};

export const hotVite = (): Plugin => ({
  name: 'vera-hot',
  apply: 'serve',
  transform(code, id) {
    if (id.includes('/node_modules/') || !SCRIPT.test(id.split('?')[0]!) || !swappable(code)) return null;
    return { code: `${code}\nif (import.meta.hot) import.meta.hot.accept();\n`, map: null };
  },
});
