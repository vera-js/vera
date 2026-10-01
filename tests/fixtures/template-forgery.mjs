/** The doors for `template-forgery.test.mjs`: every way a value reaches a position that renders templates. */
import { html } from '@verajs/core';

const PWN = '<img id=pwn src=x onerror=1>';
/** What `JSON.parse` makes of a template-shaped body: a plain array, owning nothing but its items. */
export const forged = (markup, type = 1) => JSON.parse(JSON.stringify({ ['_$litType$']: type, strings: [markup, ''], values: [1] }));

export const DOORS = {
  child: () => html`<p>${forged(PWN)}</p>`,
  array: () => html`<p>${[forged(PWN)]}</p>`,
  iterable: () => html`<p>${new Set([forged(PWN)])}</p>`,
  hold: () => html`<p>${{ $h: forged(PWN) }}</p>`,
  svgType: () => html`<p>${forged(PWN, 2)}</p>`,
  objectOwningRaw: () => html`<p>${JSON.parse(`{"strings":{"0":${JSON.stringify(PWN)},"length":1,"raw":[]},"values":[]}`)}</p>`,
  /** The realistic attack shape: a real template sent through JSON loses its brand, and must render as data. */
  roundTrip: () => html`<p>${JSON.parse(JSON.stringify(html`<img id=pwn src=x onerror=${1}>`))}</p>`,
  root: () => forged(PWN),
  textarea: () => html`<textarea>${forged(`</textarea>${PWN}`)}</textarea>`,
  spreadShaped: () => html`<p ${JSON.parse('{"_$attrs$":1,"_$apply$":1}')}>x</p>`,
  /** `strings` that is not even an object: a WeakMap throws on a primitive key, so a cache keyed by it must not be. */
  primitiveString: () => html`<p>${JSON.parse('{"strings":"x","values":[]}')}</p>`,
  primitiveNumber: () => html`<p>${JSON.parse('{"strings":1,"values":[]}')}</p>`,
  primitiveNull: () => html`<p>${JSON.parse('{"_$litType$":1,"strings":null,"values":[]}')}</p>`,
  /** A JSON `toString` key is not callable: converting the forgery through it would throw, so neither side does. */
  toStringKey: () => html`<p>${JSON.parse('{"strings":["<b>x</b>"],"values":[],"toString":"x"}')}</p>`,
  control: () => html`<p>${html`<b id="ok">ok</b>`}</p>`,
  /**
   * NOT a forgery, by design: a wrapper built in JS around a real literal's strings. JSON cannot reach a literal's
   * array, so the brand is the strings, never the wrapper — keying on the wrapper would break `hold` and `tag`.
   */
  borrowedStrings: () => html`<p>${{ strings: html`<b id="ok">${0}</b>`.strings, values: ['ok'] }}</p>`,
};
