import { expect } from '@esm-bundle/chai';
import * as coreMin from '../../packages/core/dist/vera.min.js';
import { renderer, renderInto } from '../../packages/renderer/dist/vera-renderer.min.js';
import { failedLoad, until } from './until.js';

coreMin.wire([renderer]);

/**
 * **A value in a never-shown element never runs after a save and reload, with scripting ON** (2026-11-18). jsdom parses
 * with scripting off, so its rows (tests/never-shown.test.mjs) see a `<noscript>` as markup; a real engine with scripting
 * on reads a reloaded `<noscript>` as RAW TEXT, where a value ending the element would turn the rest into live markup.
 * Core renders the value (`@verajs/lite` and `@verajs/static` refuse one there — tests/never-shown.test.mjs), the page is "saved" (`innerHTML`) and parsed again into a live element of this document
 * (scripting on), and the counter a planted handler would bump must stay 0. The control: a handler parsed the same way
 * outside any never-shown element does run, so a silence is a refusal to run, not a page that runs nothing.
 */
const literal = (pieces) => Object.assign([...pieces], { raw: [...pieces] });
const attack = (tag) => `</${tag}><img src=x onerror="window.neverShown++">`;
const SHAPES = ['iframe', 'noscript', 'xmp', 'noembed', 'noframes'].map((tag) => [tag, [`<${tag}>`, `</${tag}>`], [attack(tag)]]);
SHAPES.push(['noscript attribute', ['<noscript><img src=', '></noscript>'], ['x onerror="window.neverShown++"']]);
const SIDES = {
  core: (strings, values) => {
    const host = document.createElement('div');
    renderInto(coreMin.html(literal(strings), ...values), host);
    return host;
  },
};

/**
 * **Waited for, never timed** (2026-11-20): a fixed 200 ms was shorter than a loaded machine takes to fail the fetch, so
 * Firefox on Windows read the control's handler as not run, and the late event landed in the next row as "a handler
 * ran". The control waits for its own handler; each refusal row waits for a live SENTINEL (`failedLoad`) with the same `src=x`, whose
 * error comes from the same failed fetch, so by the time it fires a live planted handler would have fired too.
 */

it('CONTROL: a handler parsed into this document runs, so a silence below means it was kept from running', async () => {
  window.neverShown = 0;
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = '<img src=x onerror="window.neverShown++">';
  expect(await until(() => window.neverShown === 1, "() => window.neverShown === 1", 5000), 'the handler ran').to.equal(true);
  host.remove();
});

for (const [side, draw] of Object.entries(SIDES))
  it(`${side}: a value in a never-shown element never runs after a save and reload (scripting on)`, async () => {
    window.neverShown = 0;
    for (const [name, strings, values] of SHAPES) {
      const saved = draw(strings, values).innerHTML;
      const host = document.body.appendChild(document.createElement('div'));
      host.innerHTML = saved;
      expect(host.querySelectorAll('img').length === 0 || name === 'noscript attribute', `${name}: no img element: ${saved}`).to.equal(true);
      host.remove();
    }
    await failedLoad();
    expect(window.neverShown, 'a handler ran').to.equal(0);
  });

/** The analytics pixel: saved with scripting ON, parsed with scripting OFF (DOMParser has none) — the pixel loads as an element with its URL intact. */
const PIXEL = 'https://px.example/a?b=1&c=2';
for (const [side, draw] of Object.entries(SIDES))
  it(`${side}: an analytics pixel in a <noscript> survives a save and a scripting-off reload, its URL intact`, () => {
    const saved = draw(['<noscript><img src=', ' alt=""></noscript>'], [PIXEL]).innerHTML;
    const img = new DOMParser().parseFromString(`<body>${saved}`, 'text/html').querySelector('noscript img');
    expect(img !== null, `the pixel is an element with scripting off: ${saved}`).to.equal(true);
    expect(img.getAttribute('src')).to.equal(PIXEL);
  });
