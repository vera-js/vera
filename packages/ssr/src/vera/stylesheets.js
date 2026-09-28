/**
 * `CSSStyleSheet`, and the styles a render hoists out of the components it touched.
 *
 * The `StyleSheetShim` class is the DOM half — audited in place. The hoisting half (which component a
 * sheet belongs to, per request) is SSR orchestration, rebuilt in the lean rebuild from this floor.
 */

/** Light-DOM `@scope` styles hoisted during a render, keyed by the component that hoisted them. */
export const hoistedStyles = new Map();

/** Which component is rendering, so a hoist can be attributed to it. */
export const setRenderingTag = () => '';

/** Called at the start of each render. */
export const beginHoisting = () => {};

export class StyleSheetShim {
  constructor() {
    this.cssText = '';
  }
  /**
   * **`cssText` is always a string**, because the platform's argument is a `USVString` and it
   * parses what it is given. Assigning the caller's value straight through left a number, an array
   * or a plain object sitting on `cssText`, which then reached the `<style>` block by concatenation
   * — so the wrong text appeared a long way from the call that caused it. Template coercion also
   * refuses a symbol with a `TypeError`, which is what every engine does
   * (`tests/browser/dom-string-coercion.test.js`).
   */
  replaceSync(cssText) {
    this.cssText = `${cssText}`;
  }
  /** The async spelling of the same thing; `adoptStyles` uses `replaceSync`, a component may not. */
  async replace(cssText) {
    this.replaceSync(cssText);
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

/** Records a hoisted sheet against the component mid-render. */
export const hoist = () => {};
