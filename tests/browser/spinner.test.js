/**
 * **<vera-spinner> in the three engines, with `@verajs/styles` NOT wired**: the arc's rule is adopted by the element
 * itself into whichever root it renders in, keyed on its parts (so a tag of the caller's own draws the same), at zero
 * specificity, with `data-vera-look="none"` dropping it; the label is said once into the spinner's own document's
 * region. Correctness only, headless. This runner has no media emulation, so the reduced-motion and forced-colors
 * rules are read as the engine parsed them (the rule is there and names the pulse), not as matched.
 */
import { expect } from '@esm-bundle/chai';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/spinner/dist/development/vera-spinner.js';
import { defineAs } from '../../packages/components/spinner/dist/development/vera-spinner-element.js';
import { until } from './until.js';

wire([renderer]);
defineAs('my-spinner');

const frame = (win = window) => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const mount = async (markup, parent = document.body) => {
  const holder = parent.ownerDocument.createElement('div');
  holder.innerHTML = markup;
  parent.append(holder);
  flush();
  await frame();
  return holder;
};
const arcOf = (host) => host.querySelector('[data-vera-part="arc"]');
const style = (node) => node.ownerDocument.defaultView.getComputedStyle(node);
/** The turning arc's animation, as the engine computed it: the turn, or the pulse where the machine asks for reduced motion. */
const ANIMATIONS = ['vera-spinner-turn', 'vera-spinner-pulse'];
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const regionText = (doc) => [...doc.querySelectorAll('[data-vera-announce="polite"] > *')].map((m) => m.textContent);

describe('vera-spinner: the arc, unwired styles', () => {
  it('CONTROL: an arc part outside any spinner has no look', async () => {
    const span = document.createElement('span');
    span.setAttribute('data-vera-part', 'arc');
    document.body.append(span);
    expect(style(span).animationName).to.equal('none');
    span.remove();
  });

  it('draws a 1em ring that turns', async () => {
    const holder = await mount('<vera-spinner label="Loading" style="font-size:20px"></vera-spinner>');
    const arc = arcOf(holder.firstElementChild);
    const computed = style(arc);
    expect(computed.width).to.equal('20px');
    expect(computed.height).to.equal('20px');
    expect(computed.borderTopStyle).to.equal('solid');
    expect(ANIMATIONS).to.include(computed.animationName);
    if (!reduced()) {
      const first = style(arc).transform;
      const moved = await until(() => style(arc).transform !== first, 'the arc to turn', 2000);
      expect(moved).to.equal(true);
    }
    holder.remove();
  });

  it("styles only its own parts: another component's arc and label parts, by the same names, get nothing", async () => {
    const holder = await mount('<vera-spinner label="Loading" show-label></vera-spinner><div><span data-vera-part="arc"></span><span data-vera-part="label">theirs</span></div>');
    expect(ANIMATIONS, 'CONTROL: the spinner\'s own arc is drawn').to.include(style(arcOf(holder.firstElementChild)).animationName);
    expect(style(holder.firstElementChild.querySelector('[data-vera-part="label"]')).marginInlineStart, 'CONTROL: its own label is spaced').to.not.equal('0px');
    const foreign = holder.lastElementChild;
    expect(style(foreign.querySelector('[data-vera-part="arc"]')).animationName).to.equal('none');
    expect(style(foreign.querySelector('[data-vera-part="label"]')).marginInlineStart).to.equal('0px');
    holder.remove();
  });

  it('draws the same under a tag of the caller\'s own (the rule is keyed on the part, never the tag)', async () => {
    const holder = await mount('<my-spinner label="Loading"></my-spinner>');
    expect(ANIMATIONS).to.include(style(arcOf(holder.firstElementChild)).animationName);
    holder.remove();
  });

  it('data-vera-look="none" on the host or on the arc drops the look; the part stays', async () => {
    const holder = await mount('<vera-spinner label="A" data-vera-look="none"></vera-spinner><vera-spinner label="B"></vera-spinner>');
    const [none, part] = holder.children;
    expect(arcOf(none), 'the part stays').to.not.equal(null);
    expect(style(arcOf(none)).animationName).to.equal('none');
    expect(ANIMATIONS, 'CONTROL: its sibling is drawn').to.include(style(arcOf(part)).animationName);
    arcOf(part).setAttribute('data-vera-look', 'none');
    expect(style(arcOf(part)).animationName).to.equal('none');
    holder.remove();
  });

  it("a page's own rule wins (zero specificity), and the tokens size and color it", async () => {
    const page = document.createElement('style');
    page.textContent = '.big [data-vera-part="arc"] { inline-size: 40px; }';
    document.head.append(page);
    const holder = await mount(
      '<vera-spinner class="big" label="A"></vera-spinner><vera-spinner label="B" style="font-size:16px;--vera-spinner-size:2em;--vera-spinner-color:rgb(200, 0, 0)"></vera-spinner>',
    );
    const [big, tokened] = holder.children;
    expect(style(arcOf(big)).width).to.equal('40px');
    expect(style(arcOf(tokened)).width).to.equal('32px');
    expect(style(arcOf(tokened)).borderTopColor).to.equal('rgb(200, 0, 0)');
    holder.remove();
    page.remove();
  });

  it('carries a reduced-motion pulse and a forced-colors look, as the engine parsed them', async () => {
    const holder = await mount('<vera-spinner label="A"></vera-spinner>');
    const sheet = document.adoptedStyleSheets.find((s) => [...s.cssRules].some((r) => r.cssText.includes('vera-spinner-turn')));
    expect(sheet, 'the arc sheet is adopted into the document').to.not.equal(undefined);
    const media = [...sheet.cssRules].filter((r) => r.media !== undefined);
    const motion = media.find((r) => r.conditionText.includes('prefers-reduced-motion'));
    const forced = media.find((r) => r.conditionText.includes('forced-colors'));
    expect(motion.cssRules[0].style.animationName).to.equal('vera-spinner-pulse');
    /** The turning segment is the logical block-start border: declared apart from the physical top the shorthand sets. */
    const declared = forced.cssRules[0].style;
    expect(declared.getPropertyValue('border-block-start-color').toLowerCase()).to.equal('canvastext');
    /** WebKit has no forced-colors mode and drops the property; where an engine knows it, it is kept. */
    expect(declared.getPropertyValue('forced-color-adjust')).to.equal(CSS.supports('forced-color-adjust', 'none') ? 'none' : '');
    holder.remove();
  });

  it("draws inside a user's shadow root (the rule follows the element into the root it renders in)", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<vera-spinner label="Loading"></vera-spinner>';
    flush();
    await frame();
    expect(ANIMATIONS).to.include(style(arcOf(root.querySelector('vera-spinner'))).animationName);
    host.remove();
  });
});

describe('vera-spinner: what a screen reader is given', () => {
  it('says its label once in the document region, and nothing more while it spins', async () => {
    await mount('<vera-spinner label="Loading the report"></vera-spinner>');
    await until(() => regionText(document).includes('Loading the report'), 'the label in the region', 4000);
    /** A second spinner with the same label joins the load: a sentinel label said after it shows the window closed. */
    await mount('<vera-spinner label="Loading the report"></vera-spinner><vera-spinner label="sentinel"></vera-spinner>');
    await until(() => regionText(document).includes('sentinel'), 'the sentinel in the region', 4000);
    expect(regionText(document).filter((text) => text === 'Loading the report')).to.have.length(1);
    for (const element of document.querySelectorAll('vera-spinner')) element.parentElement.remove();
  });

  it('a spinner moved into an iframe speaks in the iframe\'s own region', async () => {
    const f = document.createElement('iframe');
    document.body.append(f);
    await new Promise((r) => (f.contentDocument?.readyState === 'complete' ? r() : f.addEventListener('load', r, { once: true })));
    const spinner = document.createElement('vera-spinner');
    spinner.setAttribute('label', 'Loading inside');
    f.contentDocument.body.append(spinner);
    flush();
    await frame(f.contentWindow);
    await until(() => regionText(f.contentDocument).includes('Loading inside'), "the label in the iframe's region", 4000);
    expect(regionText(document)).to.not.include('Loading inside');
    expect(ANIMATIONS, 'the arc is drawn there too').to.include(style(arcOf(spinner)).animationName);
    f.remove();
  });
});
