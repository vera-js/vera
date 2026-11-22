/**
 * **HTML folds case by ASCII only.** The SSR shim used `toLowerCase`/`toUpperCase`, which fold the Kelvin sign into
 * `k`, turn `İ` into two code units and `ß` into `SS`; jsdom folds ASCII only, but jsdom is not the oracle, so the
 * shapes the node suite (`tests/ssr-ascii-case.test.mjs`) compares are measured here on Chromium, Firefox and WebKit.
 */
import { expect } from '@esm-bundle/chai';

const kelvin = 'K';
const dottedI = 'İ';

it('createElement and tagName fold ASCII only', () => {
  expect(document.createElement('x-' + kelvin).localName === 'x-' + kelvin).to.equal(true);
  expect(document.createElement('x-' + dottedI).localName.length).to.equal(3);
  expect(document.createElement('x-ß').tagName === 'X-ß').to.equal(true);
  expect(document.createElement('x-\u{10400}').localName === 'x-\u{10400}').to.equal(true);
  expect(document.createElement('x-\u{10428}').tagName === 'X-\u{10428}').to.equal(true);
});

it('attribute names fold ASCII only, and a Kelvin-sign name stays apart from k', () => {
  const el = document.createElement('div');
  el.setAttribute(kelvin + 'ey', '1');
  expect(el.getAttribute('key') === null).to.equal(true);
  expect(el.attributes.getNamedItem('key') === null).to.equal(true);
  const parsed = document.createElement('div');
  parsed.innerHTML = '<p ' + kelvin + 'ey=1></p>';
  expect(parsed.firstChild.getAttribute('key') === null).to.equal(true);
});

it('a parsed tag name, getElementsByTagName and an i selector fold ASCII only', () => {
  const el = document.createElement('div');
  el.innerHTML = '<x-' + kelvin + '></x-' + kelvin + '><p x="' + kelvin + '"></p><p x="K"></p>';
  expect(el.firstChild.localName === 'x-' + kelvin).to.equal(true);
  el.append(document.createElement('x-k'));
  expect(el.getElementsByTagName('X-' + kelvin).length).to.equal(1);
  expect(el.querySelectorAll('[x="k" i]').length).to.equal(1);
});

it('raw text ends at its own end tag after İ, and only at one whose name ends', () => {
  const el = document.createElement('div');
  el.innerHTML = '<textarea>' + dottedI + dottedI + '</textarea><b>x</b>';
  expect(el.firstChild.value.length).to.equal(2);
  expect(el.querySelectorAll('b').length).to.equal(1);
  el.innerHTML = '<textarea>a</textareax>b</textarea><b>x</b>';
  expect(el.firstChild.value === 'a</textareax>b').to.equal(true);
});
