/**
 * **Light components served inside shadow components' declarative roots, hydrated** (2026-11-21): real
 * `@verajs/ssr` output (`tests/fixtures/ssr/styles-light-in-shadow.js`), parsed by the engine, then the components
 * defined, the LIGHT class first, so the light children upgrade inside the served roots before their shells hydrate
 * and the first shell (styled by a constructed sheet) writes its own list (the order that wiped a child's sheet before the shell kept the light ones). Each root
 * ends with exactly ONE copy of the light block, adopted there; the served nodes are the same nodes afterwards; every
 * instance is styled. (The server serves the block to the page `styles` today, not into the root: `@verajs/styles`'
 * README states it.)
 */
import { expect } from '@esm-bundle/chai';
import { captureConsole, veraSaid } from './silence.mjs';
captureConsole();
import { html, wire, define } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { hydration } from '../../packages/renderer/dist/development/vera-renderer-hydration.js';
import { styles, css } from '../../packages/styles/dist/development/vera-styles.js';
import { STYLES_IN_ROOT_HTML } from './fixtures/hello-ssr.html.js';

wire([renderer, hydration, styles]);
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const RED = 'rgb(200, 0, 0)';
const GREEN = 'rgb(0, 150, 0)';
/** How many places in `root` carry `needle`'s rules: adopted sheets and `<style>` elements. */
const copies = (root, needle) =>
  [...root.adoptedStyleSheets].filter((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes(needle))).length +
  [...root.querySelectorAll('style')].filter((element) => element.textContent.includes(needle)).length;

describe('hydrating light components served inside shadow roots', () => {
  it('each root has one copy of the light block, the served nodes are kept, and every instance is styled', async () => {
    const page = document.createElement('div');
    page.setHTMLUnsafe(STYLES_IN_ROOT_HTML);
    document.body.append(page);
    const shell = page.querySelector('ssr-root-shell');
    const shell2 = page.querySelector('ssr-root-shell2');
    expect(!!shell.shadowRoot && !!shell2.shadowRoot, 'CONTROL: the declarative roots parsed').to.equal(true);
    const served = shell.shadowRoot.querySelector('ssr-root-light .mark');
    expect(!!served, 'CONTROL: the light child was served inside the root').to.equal(true);

    define({ tag: 'ssr-root-light', styles: '.mark { color: rgb(200, 0, 0); }' }, () => () => html`<b class="mark">x</b>`);
    define({ tag: 'ssr-root-only', styles: '.only { color: rgb(0, 150, 0); }' }, () => () => html`<i class="only">o</i>`);
    await frame();
    /** The served text as a constructed sheet: its hydration drops its served copy and writes the root's list. */
    define({ tag: 'ssr-root-shell', shadow: 'open', styles: css`section { margin: 0px; }` }, () => () => html`<section><ssr-root-light></ssr-root-light><ssr-root-only></ssr-root-only></section>`);
    define({ tag: 'ssr-root-shell2', shadow: 'open' }, () => () => html`<aside><ssr-root-light></ssr-root-light></aside>`);
    define('ssr-root-page', () => () => html`<ssr-root-shell></ssr-root-shell><ssr-root-shell2></ssr-root-shell2><ssr-root-light></ssr-root-light>`);
    await frame();
    await frame();

    expect(shell.shadowRoot.querySelector('ssr-root-light .mark') === served, 'the served node is kept').to.equal(true);
    const color = (root, selector) => getComputedStyle(root.querySelector(selector)).color;
    expect({
      inShell: color(shell.shadowRoot, 'ssr-root-light .mark'),
      inShell2: color(shell2.shadowRoot, 'ssr-root-light .mark'),
      onlyInShell: color(shell.shadowRoot, 'ssr-root-only .only'),
      inPage: color(page, ':scope > ssr-root-page > ssr-root-light .mark'),
    }).to.deep.equal({ inShell: RED, inShell2: RED, onlyInShell: GREEN, inPage: RED });
    expect({
      shell: copies(shell.shadowRoot, '@scope (ssr-root-light)'),
      shell2: copies(shell2.shadowRoot, '@scope (ssr-root-light)'),
      only: copies(shell.shadowRoot, '@scope (ssr-root-only)'),
      shellOwn: copies(shell.shadowRoot, 'margin'),
    }).to.deep.equal({ shell: 1, shell2: 1, only: 1, shellOwn: 1 });
    page.remove();
  });

  after(() => {
    expect(veraSaid(), 'a healthy hydration says nothing [vera]-prefixed').to.deep.equal([]);
  });
});
