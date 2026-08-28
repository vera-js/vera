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

/**
 * Which tags have been hoisted into during the render currently in progress.
 *
 * `@verajs/styles` hoists a light-DOM component's CSS **once per class, ever** — the second instance
 * adds nothing — so a tag's sheets are established by whichever render reached it first and have to
 * persist for every render after. That is why `hoistedStyles` is not simply cleared per render.
 *
 * A component that appends its own `<style>` on every render instead of using `static styles` had no
 * such guard, so its sheets accumulated **per process**: `hoistedStyles` grew without bound, and
 * because a render returns everything recorded against the tags it touched, request thirty shipped
 * thirty-four rules — thirty-three of them belonging to earlier requests. Other people's CSS in this
 * response, growing forever.
 */
const hoistedThisRender = new Set();

/** Called at the start of each render, so the once-per-class rule is enforced across requests. */
export const beginHoisting = () => hoistedThisRender.clear();

/** Records a hoisted sheet against whichever component is mid-render. */
/** Warned once per tag, so a component hoisting per render says it once rather than every time. */
const warnedAboutDrift = /* @__PURE__ */ new Set();

export const hoist = (cssText) => {
  const sheets = hoistedStyles.get(renderingTag);
  /**
   * A tag established elsewhere keeps what it had: appending here would be a second hoist for a
   * class that has already been hoisted, which is the thing the rule forbids.
   */
  if (sheets && !hoistedThisRender.has(renderingTag)) {
    /**
     * **Silence here was the sharp edge.** A component whose CSS depends on the request — a theme,
     * a colour from a prop — has that variation dropped: whichever render arrived first set this
     * tag's sheets for the life of the process, and every later request quietly serves those. The
     * rule is deliberate and stays, because a per-class sheet emitted per instance is what it exists
     * to prevent. What was wrong was that nothing said so.
     */
    if (!sheets.includes(cssText) && !warnedAboutDrift.has(renderingTag)) {
      warnedAboutDrift.add(renderingTag);
      console.warn(
        `[vera] ssr: <${renderingTag}> hoisted different CSS than it did on an earlier render, and ` +
          `the new stylesheet was dropped. A tag's styles are established once per class for the ` +
          `life of the process, so CSS that varies per request cannot be hoisted — put the varying ` +
          `part in an inline style or a custom property instead.`
      );
    }
    return;
  }
  hoistedThisRender.add(renderingTag);
  const list = sheets ?? [];
  if (!list.includes(cssText)) list.push(cssText);
  hoistedStyles.set(renderingTag, list);
};
