import { AutoloaderOptions } from './types.js';
import { Autoloader } from '@verajs/shared-types';
import { stripTrailingSlash } from '@verajs/shared-utils';

/**
 * Inits an autoloader with the provided root directory, component directory and autoloader options.
 *
 * @param rootDir The root directory of all components. Should almost always be import.meta.url unless you are using
 * absolute paths
 * @param componentsDir The relative directory from the root directory. If element has an "autoload-dir" attribute, the
 * autoloader will read from that first
 * @param options Autoloader options. `extension` sets the file extension appended to the tag name, which lets
 * TypeScript projects autoload `.ts` sources during dev (a dev server will not serve `foo.js` when only `foo.ts`
 * exists). Defaults to `.js`
 * @return An autoloader function that should be run on desired elements each render (if lazy load elements are
 * conditionally rendered)
 */
export const initAutoloader = (
  rootDir: string,
  componentsDir?: string,
  options?: AutoloaderOptions
): Autoloader => {
  /** A configuration error fails at the misconfiguration, not once per element per render. */
  if (!rootDir) throw new Error('autoloader: rootDir is required (usually import.meta.url)');

  /** Normalized so callers may pass either `ts` or `.ts` */
  const extension = `.${(options?.extension ?? '.js').replace(/^\./, '')}`;

  /**
   * Every resolved URL must stay inside the entry's own directory. Tag names cannot carry `/`
   * (the HTML parser won't produce one), but the `autoload-dir` override is free text — and
   * CODE-PRINCIPLES #8 requires bounding anything that turns markup into a module URL. An
   * absolute, protocol-relative, or upward-traversing value resolves outside this prefix and is
   * refused.
   */
  const base = new URL('.', rootDir).href;

  /**
   * One attempt per URL per page load. Without this, a file that fails to load was retried on
   * every render — console spam and a network request each time — and the same tag reached
   * through two different dirs raced to define twice.
   */
  const attempted = new Set<string>();

  /**
   * Creates the expected element url location to be appended to the root dir.
   *
   * The per-element override attribute is `autoload-dir` — NOT `dir`, which is HTML's global
   * text-direction attribute (`dir="rtl"` on any i18n page would have silently redirected
   * component loading).
   *
   * @param element The element the autoloader is discovering
   * @param tag The element's name
   * @return The element's expected location to be appended to the root dir
   */
  const elementURL = (element: Element, tag: string) => {
    const dir = stripTrailingSlash(element.getAttribute('autoload-dir') ?? componentsDir ?? '/');
    return `${dir}/${tag}${extension}`;
  };

  /**
   * Loads an element and then recursively calls discover on that element.
   *
   * @param element The element to load
   * @param tag The tag to build the expected url from
   */
  const load = async (element: Element, tag: string): Promise<void> => {
    const src = new URL(elementURL(element, tag), rootDir).href;
    if (attempted.has(src)) return;
    attempted.add(src);

    if (!src.startsWith(base)) {
      console.error(`autoloader: refused ${src} for <${tag}> — resolves outside ${base}`);
      return;
    }

    try {
      await import(/* @vite-ignore */ src);
      await customElements.whenDefined(tag);
      discover(element);
    } catch (error) {
      console.error(`Failed to load custom element ${tag} from ${src}:`, error);
    }
  };

  /**
   * Finds all elements within a parent element that are not defined and attempts to load each of them
   *
   * @param element The element to look for undefined custom elements within
   */
  const discover = (element: Element) => {
    if (element.getAttribute('autoloader') == null) return;
    if (element.getAttribute('autoload-ignore') != null) return;
    const componentElement = element.shadowRoot ?? element;
    const elements = componentElement.querySelectorAll(':not(:defined)');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const tag = el.localName;
      if (tag?.includes('-') && !customElements.get(tag) && el.getAttribute('autoload-ignore') == null) {
        load(el, tag);
      }
    }
  };

  return discover;
};
