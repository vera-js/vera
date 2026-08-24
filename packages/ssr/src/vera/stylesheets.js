/**
 * `CSSStyleSheet`, and the collection of styles a render hoists out of the components it touched.
 *
 * A component's CSS reaches the page two ways — a `<style>` element in its shadow root, serialized
 * with it, or a constructed sheet adopted into the document, which has no markup of its own. The
 * second is what `hoistedStyles` holds, keyed by the tag that was rendering when it was adopted, so
 * a page assembled from several islands can ship each component's CSS exactly once.
 */

/**
 * `@scope (tag) { … }` styles hoisted by light-DOM components, **keyed by the component that
 * hoisted them** — the page shell embeds only the ones on the page it is building.
 *
 * A flat array here meant `renderToString` returned every style the *process* had ever hoisted, so
 * request two shipped request one's CSS and request fifty shipped everyone's. `adoptStyles` hoists
 * once per class by design, so it never grew without bound — it simply described the wrong page.
 */
export const hoistedStyles = new Map();

/**
 * Which component is rendering right now, so a hoist can be attributed to it.
 *
 * Sound because a render is synchronous end to end: `renderComponent` sets this, calls
 * `connectedCallback`, and reads the result, with no `await` anywhere in between. The only `await`
 * in the module is the `import()` that happens before any of this.
 */
let renderingTag = '';

export const setRenderingTag = (tag) => {
  const previous = renderingTag;
  renderingTag = tag;
  return previous;
};

export class StyleSheetShim {
  constructor() {
    this.cssText = '';
  }
  replaceSync(cssText) {
    this.cssText = cssText;
  }
  /** The async spelling of the same thing; `adoptStyles` uses `replaceSync`, a component may not. */
  async replace(cssText) {
    this.cssText = cssText;
    return this;
  }
  insertRule(rule) {
    this.cssText += rule;
    return 0;
  }
  /**
   * There is no rule *list* — this holds the stylesheet as text, which is all the markup needs —
   * so a rule cannot be addressed by index. Deleting one is refused rather than silently ignored.
   */
  deleteRule() {
    throw new Error('ssr: CSSStyleSheet.deleteRule needs a parsed rule list; this sheet is text');
  }
  /** The pre-standard spellings, which are still what some libraries reach for. */
  addRule(selector, style) {
    this.insertRule(`${selector} { ${style ?? ''} }`);
    return -1;
  }
  removeRule() {
    this.deleteRule();
  }
  get cssRules() {
    return [];
  }
  get rules() {
    return this.cssRules;
  }
  get ownerRule() {
    return null;
  }
  get ownerNode() {
    return null;
  }
  get parentStyleSheet() {
    return null;
  }
  get href() {
    return null;
  }
  get title() {
    return null;
  }
  get media() {
    return [];
  }
  get type() {
    return 'text/css';
  }
  disabled = false;
}

/** Records a hoisted sheet against whichever component is mid-render. */
export const hoist = (cssText) => {
  const sheets = hoistedStyles.get(renderingTag) ?? [];
  if (!sheets.includes(cssText)) sheets.push(cssText);
  hoistedStyles.set(renderingTag, sheets);
};
