/**
 * **A light component is styled in whichever root it renders in** (2026-11-21): the document, someone's shadow root, and
 * a shadow root in another document (an iframe). Its `@scope (tag)` sheet is hoisted once per class per ROOT, into that
 * root's `adoptedStyleSheets`, a sheet constructed in the element's own window (a root adopts only its own document's
 * sheets). Read from computed style in a real engine; each row has a control that the color is the component's.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, define } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { styles, css } from '../../packages/styles/dist/development/vera-styles.js';

wire([renderer, styles]);

const RED = 'rgb(200, 0, 0)';
define({ tag: 'x-root-light', styles: css`.mark { color: rgb(200, 0, 0); }` }, () => () => html`<b class="mark">x</b>`);
const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const colorIn = (root) => getComputedStyle(root.querySelector('x-root-light .mark')).color;
/** A shadow host in `doc`, its open root holding one light component, returned once it rendered. */
const inShadow = async (doc, extraCss) => {
  const hostEl = doc.createElement('div');
  const root = hostEl.attachShadow({ mode: 'open' });
  if (extraCss) root.innerHTML = `<style>${extraCss}</style>`;
  root.append(document.createElement('x-root-light'));
  doc.body.append(hostEl);
  await frame();
  return { hostEl, root };
};

describe('styles: a light component in every root', () => {
  it('in the document (CONTROL: today\'s case) and in a shadow root, both styled', async () => {
    const plain = document.createElement('x-root-light');
    document.body.append(plain);
    await frame();
    expect(colorIn(document)).to.equal(RED);
    const { hostEl, root } = await inShadow(document);
    expect(root.adoptedStyleSheets.length, 'the root adopted the sheet').to.equal(1);
    expect(colorIn(root)).to.equal(RED);
    plain.remove();
    hostEl.remove();
  });

  it('two shadow roots each get their own adoption', async () => {
    const a = await inShadow(document);
    const b = await inShadow(document);
    expect([colorIn(a.root), colorIn(b.root)]).to.deep.equal([RED, RED]);
    a.hostEl.remove();
    b.hostEl.remove();
  });

  it('a shadow root in an iframe (another document) is styled by a sheet of its own window, without throwing', async () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const doc = iframe.contentDocument;
    doc.open();
    doc.write('<!doctype html><body></body>');
    doc.close();
    const { root } = await inShadow(doc);
    expect(root.querySelector('x-root-light').ownerDocument === doc, 'CONTROL: adopted into the iframe document').to.equal(true);
    expect(root.adoptedStyleSheets.length).to.equal(1);
    expect(iframe.contentWindow.getComputedStyle(root.querySelector('x-root-light .mark')).color).to.equal(RED);
    iframe.remove();
  });

  it("the host's own shadow CSS of higher specificity still overrides the child's defaults", async () => {
    const { hostEl, root } = await inShadow(document, 'x-root-light b.mark.mark { color: rgb(0, 0, 200); }');
    expect(colorIn(root)).to.equal('rgb(0, 0, 200)');
    hostEl.remove();
  });
});
