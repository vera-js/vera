import data from './data.json' with { type: 'json' };
/** Every import form the loader rewrites: a template literal, a full URL, options, and import.meta. */
const name = 'late';
const templated = await import(`./${name}.jsx`);
const byUrl = await import(new URL('./late.jsx', import.meta.url));
const viaOptions = await import('./data.json', { with: { type: 'json' } });
/** A call followed by a block on the next line, no semicolon: still a call, not a method. */
let blockRan = false
const afterBlock = await import('./late.jsx')
{
  blockRan = true;
}
parent.postMessage({
  kind: 'app',
  templated: templated.value,
  sameModule: byUrl === templated && afterBlock === templated,
  blockRan,
  json: data.hello,
  dynamicJson: viaOptions.default.hello,
  resolved: import.meta.resolve('./late.jsx'),
  meta: import.meta.url,
}, '*');
