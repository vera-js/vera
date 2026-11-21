/**
 * **A light component is styled in whichever root it renders in** (2026-11-21): the document, someone's shadow root, and
 * a shadow root in another document (an iframe). Its `@scope (tag)` sheet is hoisted once per class per ROOT, into that
 * root's `adoptedStyleSheets`, a sheet constructed in the element's own window (a root adopts only its own document's
 * sheets). Read from computed style in a real engine; each row has a control that the color is the component's.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire, define } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import { styles, css, applyStyles } from '../../packages/styles/dist/development/vera-styles.js';

wire([renderer, styles]);

const RED = 'rgb(200, 0, 0)';
define({ tag: 'x-root-light', styles: css`.mark { color: rgb(200, 0, 0); }` }, () => () => html`<b class="mark">x</b>`);
/** A shadow component of ours with its own constructed sheet, rendering a light child into its root. */
define({ tag: 'x-root-shell', shadow: 'open', styles: css`i { color: rgb(0, 0, 200); }` }, () => () => html`<i>s</i><x-root-light></x-root-light>`);
const iframeReady = async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  await new Promise((r) => (f.contentDocument?.readyState === 'complete' ? r() : f.addEventListener('load', r, { once: true })));
  return f;
};
/** The light child's color inside `shell`'s root, read in the shell's own window. */
const childColor = (shell) => shell.ownerDocument.defaultView.getComputedStyle(shell.shadowRoot.querySelector('x-root-light .mark')).color;
const frame = (win = window) => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
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

describe("styles: a light child in our own shadow component's root", () => {
  it("survives the shell writing its own list again (a theme switch through applyStyles)", async () => {
    const shell = document.createElement('x-root-shell');
    document.body.append(shell);
    await frame();
    expect(childColor(shell), 'CONTROL: styled after the first render').to.equal(RED);
    applyStyles([css`i { color: rgb(0, 0, 200); }`, css`i { font-weight: 700; }`], shell);
    await frame();
    expect(childColor(shell), "the child's sheet is kept when the shell replaces its own").to.equal(RED);
    shell.remove();
  });

  it('holds in another document and after returning (a move empties the root, the child re-hoists)', async () => {
    const shell = document.createElement('x-root-shell');
    document.body.append(shell);
    await frame();
    const home1 = childColor(shell);
    const f = await iframeReady();
    f.contentDocument.body.append(shell);
    await frame(f.contentWindow);
    const out = childColor(shell);
    document.body.append(shell);
    await frame();
    const home2 = childColor(shell);
    expect({ home1, out, home2 }).to.deep.equal({ home1: RED, out: RED, home2: RED });
    shell.remove();
    f.remove();
  });

  it("the shell's own sheets come first and the light defaults after, as in the document (adopted after the page's)", async () => {
    const shell = document.createElement('x-root-shell');
    document.body.append(shell);
    await frame();
    const texts = [...shell.shadowRoot.adoptedStyleSheets].map((sheet) => [...sheet.cssRules].map((rule) => rule.cssText).join(' '));
    expect(texts.length, 'CONTROL: two sheets in the root').to.equal(2);
    expect(texts[0].includes('rgb(0, 0, 200)') && texts[1].includes('@scope (x-root-light)'), texts.join(' | ')).to.equal(true);
    shell.remove();
  });
});
