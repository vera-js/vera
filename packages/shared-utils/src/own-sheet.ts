/**
 * **A component's own small sheet, adopted into the root it renders in, without `@verajs/styles`.** For a rule a
 * component cannot work without (kbd's spoken words live in CSS alt text), so it must not depend on the app having
 * wired the styles module. The second sanctioned path beside `styles`; use it only for a rule the component's meaning
 * needs, never for its look.
 *
 * - **Per root, keyed by a string on the root** (`key`, a `_$…$` name the minifier leaves alone), so two copies of a
 *   package agree and there is no module-level state: the root holds its sheet.
 * - **Built by the root's own window's `CSSStyleSheet`.** A constructed sheet may be adopted only by the document that
 *   constructed it, so a root that moved into another document (its adopted sheets are emptied) gets a new one.
 * - **Re-appended when missing**, so a page that replaced the root's `adoptedStyleSheets` gets it back at the next
 *   connect.
 * - **Marked light in a shadow root** with `@verajs/styles`' string key, so that root's own component, writing its list
 *   again (a theme switch, a re-init), keeps this sheet as it keeps every light child's.
 *
 * Does nothing where there is no window (the server: it renders no markup that needs the rule), no root to adopt
 * into (a node in no document or shadow root), or no constructable stylesheets (jsdom has the constructor but neither
 * `replaceSync` nor `adoptedStyleSheets`). Never a `<style>` element instead: that would add a node to a shadow root
 * the user's own code may own.
 */

/** `@verajs/styles`' mark for a light child's sheet in a shadow root, and for the root holding one (a protocol, by string). */
const LIGHT = '_$veraLight$';

type Holder = Record<string, unknown>;
type Adopting = (Document | ShadowRoot) & { adoptedStyleSheets: CSSStyleSheet[] };

/**
 * Adopts `css` once into the root `element` renders in.
 *
 * @param element The component's host
 * @param key A `_$…$` string naming this sheet on the root (one per package and rule)
 * @param css The rule text
 */
export const adoptOwnSheet = (element: Element, key: string, css: string): void => {
  const root = element.getRootNode() as Node;
  /** Node types, never `instanceof`: a root made in another window answers by its structure (9 a document, 11 a shadow root with a host). */
  const shadow = root.nodeType === 11 && (root as ShadowRoot).host != null;
  if (root.nodeType !== 9 && !shadow) return;
  const doc = shadow ? (root.ownerDocument as Document) : (root as Document);
  const Sheet = doc.defaultView?.CSSStyleSheet;
  const adopting = root as Adopting;
  if (typeof Sheet?.prototype.replaceSync !== 'function' || !Array.isArray(adopting.adoptedStyleSheets)) return;
  const holder = root as unknown as Holder;
  let sheet = holder[key] as (CSSStyleSheet & Holder) | undefined;
  if (sheet === undefined || sheet[key] !== doc) {
    sheet = new Sheet() as CSSStyleSheet & Holder;
    sheet.replaceSync(css);
    sheet[key] = doc;
    holder[key] = sheet;
  }
  if (!adopting.adoptedStyleSheets.includes(sheet)) adopting.adoptedStyleSheets = [...adopting.adoptedStyleSheets, sheet];
  if (shadow) sheet[LIGHT] = holder[LIGHT] = true;
};
