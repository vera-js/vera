/**
 * `CSSStyleSheet`, and the styles a render hoists out of the components it touched.
 *
 * The `StyleSheetShim` class is the DOM half — audited in place. The hoisting half (which component a
 * sheet belongs to, per request) is SSR orchestration, rebuilt in the lean rebuild from this floor.
 */

/**
 * Light-DOM `@scope` styles hoisted during renders, **keyed by the component that hoisted them**, so a
 * render returns only the CSS of the page it built — a flat list returned every style the process had
 * ever hoisted, request one's CSS in request two's response.
 */
export const hoistedStyles = new Map();

/** The component rendering right now, so a hoist can be attributed to it (renders take turns). */
let renderingTag = '';
export const setRenderingTag = (tag) => {
  const previous = renderingTag;
  renderingTag = tag;
  return previous;
};

/**
 * The tags that hoisted during the render in progress. `@verajs/styles` hoists once per class, so a tag
 * whose sheets were recorded by an earlier request keeps them — but a component that appends its own
 * `<style>` every render has no such guard, and without a per-render rule its sheets accumulated per
 * PROCESS, request thirty shipping twenty-nine requests of other people's CSS.
 */
const hoistedThisRender = new Set();
export const beginHoisting = () => hoistedThisRender.clear();

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

/** Warned once per tag. */
const warnedAboutDrift = new Set();

/**
 * Records a hoisted sheet against the component mid-render. A tag already established by an earlier
 * render keeps what it had — and if the new CSS DIFFERS, that is said once: CSS that varies per request
 * (a theme, a prop) cannot be hoisted per class, and dropping the variation silently served every later
 * request the first request's styles.
 */
export const hoist = (cssText) => {
  const sheets = hoistedStyles.get(renderingTag);
  if (sheets && !hoistedThisRender.has(renderingTag)) {
    if (!sheets.includes(cssText) && !warnedAboutDrift.has(renderingTag)) {
      warnedAboutDrift.add(renderingTag);
      console.warn(
        `[vera] ssr: <${renderingTag}> hoisted different CSS than it did on an earlier render, and the new ` +
          `stylesheet was dropped. A tag's styles are established once per class for the life of the process, ` +
          `so CSS that varies per request cannot be hoisted — put the varying part in an inline style or a ` +
          `custom property instead.`
      );
    }
    return;
  }
  hoistedThisRender.add(renderingTag);
  const list = sheets ?? [];
  if (!list.includes(cssText)) list.push(cssText);
  hoistedStyles.set(renderingTag, list);
};
