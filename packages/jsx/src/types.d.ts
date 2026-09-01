/**
 * Permissive TSX typings: every element accepts every prop, so TSX compiles today. The fully
 * typed IntrinsicElements surface is the known long tail. Use with
 * `"jsx": "preserve"` — the plugin, not tsc, transforms JSX.
 */
declare global {
  namespace JSX {
    type Element = unknown;
    interface IntrinsicElements {
      [tagName: string]: Record<string, unknown>;
    }
    interface ElementChildrenAttribute {
      children: object;
    }
  }
}

export interface VeraJsxOptions {
  /** Skip auto-injecting `html`/`keyed` imports. */
  inject?: boolean;
  /** [importedName, moduleSpecifier] for the template tag. Default ['html', '@verajs/core']. */
  html?: [string, string];
  /** [importedName, moduleSpecifier] for keyed(). Default ['keyed', '@verajs/renderer/keyed']. */
  keyed?: [string, string];
}

export function transformJsx(code: string, fileName?: string, options?: VeraJsxOptions): string;
export function veraJsx(options?: VeraJsxOptions): {
  name: string;
  enforce: 'pre';
  transform(code: string, id: string): { code: string; map: null } | null;
};
export default veraJsx;
