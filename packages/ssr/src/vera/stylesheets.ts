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
export const hoistedStyles = new Map<string, string[]>();

/** The component rendering right now, so a hoist can be attributed to it (renders take turns). */
let renderingTag = '';
export const setRenderingTag = (tag: string): string => {
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
const hoistedThisRender = new Set<string>();
export const beginHoisting = (): void => {
  hoistedThisRender.clear();
  /** Each render is its own page, and a page starts with no adopted sheets — which also bounds the list. */
  documentSheets.length = 0;
};

export class StyleSheetShim {
  declare cssText: string;
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
  replaceSync(cssText: unknown): void {
    this.cssText = `${cssText}`;
  }
  /** The async spelling of the same thing; `adoptStyles` uses `replaceSync`, a component may not. */
  async replace(cssText: unknown): Promise<this> {
    this.replaceSync(cssText);
    return this;
  }
  insertRule(rule: string): number {
    this.cssText += rule;
    return 0;
  }
  /**
   * There is no rule *list* — this holds the stylesheet as text, which is all the markup needs —
   * so a rule cannot be addressed by index. Deleting one is refused rather than silently ignored.
   */
  deleteRule(): never {
    throw new Error('ssr: CSSStyleSheet.deleteRule needs a parsed rule list; this sheet is text');
  }
  /** The pre-standard spellings, which are still what some libraries reach for. */
  addRule(selector: string, style?: string): number {
    this.insertRule(`${selector} { ${style ?? ''} }`);
    return -1;
  }
  removeRule(): void {
    this.deleteRule();
  }
  get cssRules(): never[] {
    return [];
  }
  get rules(): never[] {
    return this.cssRules;
  }
  get ownerRule(): null {
    return null;
  }
  get ownerNode(): null {
    return null;
  }
  get parentStyleSheet(): null {
    return null;
  }
  get href(): null {
    return null;
  }
  get title(): null {
    return null;
  }
  get media(): never[] {
    return [];
  }
  get type(): string {
    return 'text/css';
  }
  disabled = false;
}

/** Warned once per tag. */
const warnedAboutDrift = new Set<string>();

/**
 * Records a hoisted sheet against the component mid-render. A tag already established by an earlier
 * render keeps what it had — and if the new CSS DIFFERS, that is said once: CSS that varies per request
 * (a theme, a prop) cannot be hoisted per class, and dropping the variation silently served every later
 * request the first request's styles.
 */
export const hoist = (cssText: string): void => {
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

/**
 * **`document.adoptedStyleSheets`: a live list, and every sheet that joins it is hoisted.** It was an empty array
 * on every read, and its setter hoisted only the LAST sheet assigned — right for `@verajs/styles`, which appends one
 * at a time, and wrong for `document.adoptedStyleSheets = [a, b]`, which served `b` and dropped `a`. Now a write —
 * assignment, or an indexed write such as `push`, which the platform allows on its observable array — hoists each sheet
 * not already in the list, attributed to the component rendering, and a read answers what was adopted this render.
 * Checked as the platform checks: a value that is not a sequence, or an entry that is not a `CSSStyleSheet`, is a
 * `TypeError`, before anything changes.
 */
const documentSheets: StyleSheetShim[] = [];
const checkSheet = (sheet: unknown): StyleSheetShim => {
  if (!(sheet instanceof StyleSheetShim))
    throw new TypeError(`Failed to set the 'adoptedStyleSheets' property: the provided value is not of type 'CSSStyleSheet'.`);
  return sheet;
};
const adopt = (sheet: StyleSheetShim): void => {
  if (!documentSheets.includes(sheet) && sheet.cssText) hoist(sheet.cssText);
};
/** What a read of `document.adoptedStyleSheets` answers: the list itself, with indexed writes checked and hoisted. */
export const documentAdoptedSheets = new Proxy(documentSheets, {
  set(target, key, value: unknown) {
    if (typeof key === 'string' && /^\d+$/.test(key)) adopt(checkSheet(value));
    return Reflect.set(target, key, value);
  },
});
/** What an assignment to `document.adoptedStyleSheets` does. */
export const setDocumentAdoptedSheets = (sheets: unknown): void => {
  if (!Array.isArray(sheets))
    throw new TypeError(`Failed to set the 'adoptedStyleSheets' property: the provided value cannot be converted to a sequence.`);
  const checked = sheets.map(checkSheet);
  for (const sheet of checked) adopt(sheet);
  documentSheets.length = 0;
  documentSheets.push(...checked);
};
