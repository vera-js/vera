import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment','Event','CustomEvent','NodeFilter','MutationObserver','ShadowRoot'])
  globalThis[k] = dom.window[k];
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
const { load } = await import('./tests/dist.mjs');
const { wire } = await load('core');
const R = await load('renderer');
console.log('  renderer exports :', Object.keys(R).join(' '));
try { wire([R.render]); console.log('  wire([render])   : accepted'); }
catch (e) { console.log('  wire([render])   : THREW —', e.message.slice(0, 130)); }
