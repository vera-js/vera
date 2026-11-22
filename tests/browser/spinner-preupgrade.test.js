/**
 * **<vera-spinner> before its script runs**, in the three engines: server markup with the server's `styles` (the real
 * `@verajs/ssr` output, `SPINNER_SSR` in the hydration fixture) turns with no script at all, keyframes inside the
 * `@scope` block included; an empty, not yet defined spinner on a page that links `preupgrade.css` turns through its
 * host's generated content; the two never draw two rings; and once defined, the generated ring gives way to the arc
 * part. Each page without script is an iframe whose document never defines the tag. This runner has no media
 * emulation, so the reduced-motion and forced-colors branches are read as the engine parsed them.
 */
import { expect } from '@esm-bundle/chai';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/spinner/dist/development/vera-spinner.js';
import { SPINNER_SSR } from './fixtures/hello-ssr.html.js';
import { until } from './until.js';

wire([renderer]);

const PREUPGRADE = new URL('../../packages/components/spinner/dist/preupgrade.css', import.meta.url).href;
const ANIMATIONS = ['vera-spinner-turn', 'vera-spinner-pulse'];
const link = `<link rel="stylesheet" href="${PREUPGRADE}">`;

/** A page with no script: `markup` in an iframe's own document, which never defines the tag. */
const page = async (markup) => {
  const f = document.createElement('iframe');
  f.srcdoc = `<!doctype html><html><head></head><body>${markup}</body></html>`;
  document.body.append(f);
  await new Promise((resolve) => f.addEventListener('load', resolve, { once: true }));
  return f;
};
const computed = (node, pseudo) => node.ownerDocument.defaultView.getComputedStyle(node, pseudo);

describe('vera-spinner: before upgrade', () => {
  it('server markup with the server\'s styles turns with no script (keyframes inside @scope)', async () => {
    const f = await page(`<style>${SPINNER_SSR.styles}</style>${SPINNER_SSR.html}`);
    const host = f.contentDocument.querySelector('vera-spinner');
    expect(f.contentWindow.customElements.get('vera-spinner'), 'CONTROL: no script defined it').to.equal(undefined);
    const arc = host.querySelector('[data-vera-part="arc"]');
    expect(ANIMATIONS).to.include(computed(arc).animationName);
    expect(computed(arc).borderTopStyle).to.equal('solid');
    if (!f.contentWindow.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const first = computed(arc).transform;
      await until(() => computed(arc).transform !== first, 'the served arc to turn', 2000);
    }
    f.remove();
  });

  it('CONTROL: an empty spinner with no preupgrade.css draws nothing', async () => {
    const f = await page('<vera-spinner></vera-spinner>');
    expect(computed(f.contentDocument.querySelector('vera-spinner'), '::before').animationName).to.equal('none');
    f.remove();
  });

  it('an empty spinner on a page linking preupgrade.css turns through its host\'s generated ring', async () => {
    const f = await page(`${link}<vera-spinner style="font-size:20px"></vera-spinner>`);
    const host = f.contentDocument.querySelector('vera-spinner');
    const ring = await until(() => {
      const style = computed(host, '::before');
      return ANIMATIONS.includes(style.animationName) && style;
    }, 'the preupgrade ring', 4000);
    expect(ring.width).to.equal('20px');
    f.remove();
  });

  it('server markup on a page that also links preupgrade.css draws one ring, never two', async () => {
    const f = await page(`${link}<style>${SPINNER_SSR.styles}</style>${SPINNER_SSR.html}<vera-spinner></vera-spinner>`);
    const [served, empty] = f.contentDocument.querySelectorAll('vera-spinner');
    await until(() => ANIMATIONS.includes(computed(empty, '::before').animationName), 'CONTROL: the sheet loaded', 4000);
    expect(computed(served, '::before').animationName, 'no generated ring beside the served arc').to.equal('none');
    expect(ANIMATIONS).to.include(computed(served.querySelector('[data-vera-part="arc"]')).animationName);
    f.remove();
  });

  it('data-vera-look="none" on a waiting host drops the ring', async () => {
    const f = await page(`${link}<vera-spinner data-vera-look="none"></vera-spinner><vera-spinner></vera-spinner>`);
    const [none, control] = f.contentDocument.querySelectorAll('vera-spinner');
    await until(() => ANIMATIONS.includes(computed(control, '::before').animationName), 'CONTROL: the sheet loaded', 4000);
    expect(computed(none, '::before').animationName).to.equal('none');
    f.remove();
  });

  it('once defined, the generated ring gives way to the arc part', async () => {
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = PREUPGRADE;
    document.head.append(sheet);
    await new Promise((resolve) => sheet.addEventListener('load', resolve, { once: true }));
    const host = document.createElement('vera-spinner');
    host.setAttribute('label', 'Loading');
    document.body.append(host);
    flush();
    expect(host.matches(':defined'), 'CONTROL: this document defines the tag').to.equal(true);
    expect(computed(host, '::before').animationName).to.equal('none');
    expect(ANIMATIONS).to.include(computed(host.querySelector('[data-vera-part="arc"]')).animationName);
    host.remove();
    sheet.remove();
  });

  it('preupgrade.css carries the reduced-motion pulse and the forced-colors look, in @layer vera', async () => {
    const text = await (await fetch(PREUPGRADE)).text();
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    const layer = sheet.cssRules[0];
    expect(layer.name).to.equal('vera');
    const media = [...layer.cssRules].filter((rule) => rule.media !== undefined);
    expect(media.find((r) => r.conditionText.includes('prefers-reduced-motion')).cssRules[0].style.animationName).to.equal('vera-spinner-pulse');
    expect(media.find((r) => r.conditionText.includes('forced-colors')).cssRules[0].style.getPropertyValue('border-block-start-color').toLowerCase()).to.equal('canvastext');
  });
});
