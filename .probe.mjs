import { serializeTemplate } from '@verajs/ssr/vera';
const { html } = await import('@verajs/core');
const { spread } = await import('@verajs/renderer/spread');
console.log('  written !checked true  :', serializeTemplate(html`<input type="checkbox" !checked=${true} />`));
console.log('  written !checked false :', serializeTemplate(html`<input type="checkbox" !checked=${false} />`));
console.log('  written .checked true  :', serializeTemplate(html`<input type="checkbox" .checked=${true} />`));
console.log('  written !value         :', serializeTemplate(html`<input !value=${'v'} />`));
console.log('  spread  !checked true  :', serializeTemplate(html`<input type="checkbox" ${spread({ '!checked': true })} />`));
