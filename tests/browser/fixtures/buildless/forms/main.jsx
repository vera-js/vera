import data from './data.json' with { type: 'json' };
/** Every import form the loader rewrites: a template literal, a computed path, options, and import.meta. */
const name = 'late';
const templated = await import(`./${name}.jsx`);
const viaOptions = await import('./data.json', { with: { type: 'json' } });
parent.postMessage({
  kind: 'app',
  templated: templated.value,
  json: data.hello,
  dynamicJson: viaOptions.default.hello,
  resolved: import.meta.resolve('./late.jsx'),
  meta: import.meta.url,
}, '*');
