/**
 * What `@verajs/ssr` serves for a value inside an open `<select>` (2026-11-21): the browser suite parses each on all three
 * engines (`tests/browser/ssr-select-raw-text.test.js`), and `tests/ssr-select-raw-text.test.mjs` asserts each is
 * exactly what the server serves, so the two cannot drift. `value` is the attack: it closes the select and adds an
 * `<img>` that would run.
 */
const VALUE = '</select><img id=pwn src=x>';
export const SELECT_CASES = [
  { statics: ['<select><style>', '</style></select>'], value: VALUE, served: '<select><style>&#60;/select&#62;&#60;img id=pwn src=x&#62;</style></select>' },
  { statics: ['<select><svg><foreignObject><style>', '</style></foreignObject></svg></select>'], value: VALUE, served: '<select><svg><foreignObject><style>&#60;/select&#62;&#60;img id=pwn src=x&#62;</style></foreignObject></svg></select>' },
  { statics: ['<select><option>', '</option></select>'], value: VALUE, served: '<select><option>&#60;/select&#62;&#60;img id=pwn src=x&#62;</option></select>' },
  { statics: ['<select .innerHTML=', '></select>'], value: `<style>${VALUE}</style>`, served: '<select>&#60;style&#62;&#60;/select&#62;&#60;img id=pwn src=x&#62;&#60;/style&#62;</select>' },
  { statics: ['<select><option .innerHTML=', '></option></select>'], value: `<style>${VALUE}</style>`, served: '<select><option>&#60;style&#62;&#60;/select&#62;&#60;img id=pwn src=x&#62;&#60;/style&#62;</option></select>' },
];
