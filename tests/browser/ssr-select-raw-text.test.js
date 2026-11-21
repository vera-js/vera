/**
 * **What the server serves for a value inside an open `<select>` injects nothing in a current engine** (2026-11-21):
 * the engines' half of `tests/ssr-select-raw-text.test.mjs`, whose oracle is the older select parser. Current engines
 * read a `<style>` inside a select as raw text, the older parser as markup; the server escapes the value, the one
 * form safe under both. Each served form is parsed as a whole page, and no `#pwn` element is built.
 */
import { expect } from '@esm-bundle/chai';
import { SELECT_CASES } from './fixtures/ssr-select-served.js';

const built = (markup) => new DOMParser().parseFromString(`<!doctype html><body>${markup}</body>`, 'text/html').querySelectorAll('#pwn').length;

describe('a value served inside an open select', () => {
  it('control: an img the markup really carries is built', () => {
    expect(built('<select></select><img id=pwn src=x>')).to.equal(1);
  });

  it('builds no element, in every served form', () => {
    expect(SELECT_CASES.length >= 4, 'a floor on the cases').to.equal(true);
    const found = SELECT_CASES.map(({ statics, served }) => `${statics[0]}: ${built(served)}`);
    expect(found).to.deep.equal(SELECT_CASES.map(({ statics }) => `${statics[0]}: 0`));
  });
});
