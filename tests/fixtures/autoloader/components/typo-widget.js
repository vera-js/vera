/**
 * Imports cleanly and defines the **wrong** tag — the everyday typo, and the shape that used to be
 * silent forever: `whenDefined` never settles, so the autoloader's catch never ran.
 */
customElements.define('typo-wdiget', class extends HTMLElement {});
