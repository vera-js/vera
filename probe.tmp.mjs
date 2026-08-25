import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const k of ['window','document','HTMLElement','customElements','CSSStyleSheet','Node','Element','DocumentFragment'])
  globalThis[k] = dom.window[k];
const { render } = await import('./packages/renderer/dist/development/vera-renderer.js');
const { tag, html } = await import('./packages/renderer/dist/development/vera-renderer-tag.js');
const host = () => { const d = document.createElement('div'); document.body.append(d); return d; };

// dynamic tag name
{ const h = host();
  const draw = (t) => html`<${t} class="x">body</${t}>`;
  render(draw(tag`h1`), h); console.log('tag h1:', h.innerHTML.replace(/<!---->/g, ''));
  render(draw(tag`h2`), h); console.log('tag h2:', h.innerHTML.replace(/<!---->/g, '')); }

// template identity across tag changes at one call site
{ const h = host();
  const draw = (t, n) => html`<${t}>${n}</${t}>`;
  render(draw(tag`p`, 1), h); const el1 = h.querySelector('p');
  render(draw(tag`p`, 2), h);
  console.log('same tag keeps element:', h.querySelector('p') === el1, '| text:', h.querySelector('p')?.textContent); }

// a string may not become markup
{ const h = host();
  try { render(html`<${'script'}>x</${'script'}>`, h); console.log('string tag: ALLOWED ->', h.innerHTML); }
  catch (e) { console.log('string tag refused:', e.message.slice(0, 60)); } }

// tag with attributes bound
{ const h = host();
  const draw = (t, v) => html`<${t} title=${v}>b</${t}>`;
  render(draw(tag`div`, 'a'), h);
  console.log('tag + bound attr:', h.querySelector('div')?.getAttribute('title'));
  render(draw(tag`div`, 'b'), h);
  console.log('updated:', h.querySelector('div')?.getAttribute('title')); }
