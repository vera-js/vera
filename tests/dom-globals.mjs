/**
 * Installs a jsdom environment on `globalThis`, for a child process that must have one **before**
 * its first `import` is evaluated.
 *
 * `@verajs/renderer` builds two shared `TreeWalker`s at module scope, so it throws against a bare
 * Node global object. A harness that sets the globals in its own body is too late: ESM evaluates
 * every static import before the first statement runs. Loading this with `node --import` is early
 * enough, which an inline `-e` script cannot be.
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'Event', 'CustomEvent', 'MouseEvent', 'PopStateEvent', 'NodeFilter', 'Comment', 'Text', 'MutationObserver', 'ShadowRoot', 'DOMException'])
  globalThis[key] = dom.window[key];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
