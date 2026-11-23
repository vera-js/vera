/** A module that adopts a document sheet at import, outside any component: the render that imports it hoists the sheet. */
const sheet = new CSSStyleSheet();
sheet.replaceSync('p { color: module-sheet-ssr }');
document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
export default class ModuleSheetSsr extends HTMLElement {
  connectedCallback() {
    this.append('m');
  }
}
customElements.define('module-sheet-ssr', ModuleSheetSsr);
