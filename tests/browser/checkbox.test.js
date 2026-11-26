/**
 * **<vera-checkbox> and <vera-switch> in the three engines: what jsdom cannot answer.** The native switch where the
 * engine has it and `role="switch"` where it does not, never both, with the form value a checkbox's; a real click on a
 * mixed box, and one a later listener cancels; Space toggles and Enter does not; the 24px target at every size; the
 * thumb's mirror under rtl and its jump under reduced motion; look none; the forced-colors rules as the engine parsed
 * them (this runner has no forced-colors emulation); the field's label reaching the input; and axe over every state.
 * Correctness only, headless: never time with it.
 */
import { expect } from '@esm-bundle/chai';
import { emulateMedia, sendKeys, sendMouse } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/checkbox/dist/development/vera-checkbox.js';
import '../../packages/components/field/dist/development/vera-field.js';
import { ENGINE, ON } from './engine.js';
import { until } from './until.js';

wire([renderer]);

const said = [];
const warn = console.warn;
console.warn = (...args) => {
  said.push(String(args[0]));
  warn(...args);
};

const mount = async (inner) => {
  const wrap = document.createElement('div');
  wrap.innerHTML = inner;
  document.body.append(wrap);
  flush();
  await Promise.resolve();
  flush();
  return wrap;
};
const style = (el) => getComputedStyle(el);
const box = (el) => el.getBoundingClientRect();
/** A real pointer click at the element's center. */
const clickOn = async (el) => {
  const r = box(el);
  await sendMouse({ type: 'click', position: [Math.round(r.x + r.width / 2), Math.round(r.y + r.height / 2)] });
};
const LABELED = (attrs = '') => `<label><input type="checkbox" name="n"${attrs}> Label</label>`;

describe('vera-switch: the platform switch where it exists', () => {
  /**
   * Which engines expose the native switch (`HTMLInputElement.prototype.switch`), measured, and it is per platform, not
   * per engine: Playwright's WebKit 27 has it on macOS and not on Windows 11 or the Linux CI runner; Chromium 159 and
   * Firefox 159 have it nowhere (2026-11-26). Safari 17.4 ships it. A runner that gains or loses it turns this red, so the
   * table is updated with the browser ledger; where it is absent, the native branch is met in jsdom with it faked present.
   */
  const MAC = /Macintosh|Mac OS X/.test(navigator.userAgent);
  const NATIVE = { Chromium: false, Firefox: false, WebKit: MAC };

  it('the input carries exactly one of the native switch and role="switch": the switch where the engine has it, the role elsewhere', async () => {
    const wrap = await mount(`<vera-switch>${LABELED()}</vera-switch>`);
    const input = wrap.querySelector('input');
    const native = 'switch' in HTMLInputElement.prototype;
    expect(native, `${ON}: the native switch, as measured for this engine`).to.equal(NATIVE[ENGINE?.name]);
    expect(input.hasAttribute('switch'), `${ON}: switch`).to.equal(native);
    expect(input.getAttribute('role'), `${ON}: role`).to.equal(native ? null : 'switch');
    wrap.remove();
  });

  it("it submits exactly as a checkbox does, and its label's text is the same in both states", async () => {
    const wrap = await mount(`<form><vera-switch>${LABELED()}</vera-switch><input type="checkbox" name="n2" checked></form>`);
    const form = wrap.querySelector('form');
    const input = wrap.querySelector('vera-switch input');
    const label = wrap.querySelector('label').textContent;
    expect([...new FormData(form).keys()], `${ON}: off, it submits nothing`).to.deep.equal(['n2']);
    await clickOn(input);
    expect(input.checked, `${ON}: the click turned it on`).to.equal(true);
    expect(new FormData(form).get('n'), `${ON}: on, the value a checkbox submits`).to.equal(new FormData(form).get('n2'));
    expect(wrap.querySelector('label').textContent, `${ON}: the label is unchanged`).to.equal(label);
    wrap.remove();
  });
});

describe('vera-checkbox: mixed', () => {
  it('a real click on a mixed box checks it, clears mixed and the attribute, with one input and one change', async () => {
    const wrap = await mount(`<vera-checkbox indeterminate>${LABELED()}</vera-checkbox>`);
    const host = wrap.querySelector('vera-checkbox');
    const input = host.querySelector('input');
    expect(input.indeterminate, `${ON}: CONTROL: the attribute set the property`).to.equal(true);
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    await clickOn(input);
    flush();
    expect({ checked: input.checked, mixed: input.indeterminate, attribute: host.hasAttribute('indeterminate'), events }, ON).to.deep.equal({
      checked: true,
      mixed: false,
      attribute: false,
      events: ['input', 'change'],
    });
    wrap.remove();
  });

  for (const how of ['a real click', 'input.click()'])
    it(`${how} that a later listener on the document cancels leaves the box mixed, unchecked, and the attribute on`, async () => {
      const wrap = await mount(`<vera-checkbox indeterminate>${LABELED()}</vera-checkbox>`);
      const host = wrap.querySelector('vera-checkbox');
      const input = host.querySelector('input');
      let canceled = 0;
      const cancel = (event) => {
        if (event.target === input) {
          event.preventDefault();
          canceled += 1;
        }
      };
      document.addEventListener('click', cancel);
      if (how === 'a real click') await clickOn(input);
      else input.click();
      flush();
      document.removeEventListener('click', cancel);
      expect(canceled, `${ON}: CONTROL: the click reached the canceling listener`).to.equal(1);
      expect({ checked: input.checked, mixed: input.indeterminate, attribute: host.hasAttribute('indeterminate') }, ON).to.deep.equal({
        checked: false,
        mixed: true,
        attribute: true,
      });
      wrap.remove();
    });

  /**
   * Read after one microtask turn, not at the next frame: a page paints only after its microtask checkpoint, so a dash
   * there is a dash before any paint; and in this runner's Chromium the next frame came more than 500 ms after the
   * write, so a frame-timed read could not tell a deferred dash from a prompt one.
   */
  it('the attribute written by script shows the dash before the page can paint, and its removal clears it there', async () => {
    const wrap = await mount(`<vera-checkbox>${LABELED()}</vera-checkbox>`);
    const host = wrap.querySelector('vera-checkbox');
    const input = wrap.querySelector('input');
    expect(input.matches(':indeterminate'), `${ON}: CONTROL: not mixed before the write`).to.equal(false);
    /** No flush(): what a page's own script gets when it sets the attribute and yields. */
    host.setAttribute('indeterminate', '');
    await Promise.resolve();
    expect(input.matches(':indeterminate'), `${ON}: mixed by the end of the microtask checkpoint`).to.equal(true);
    host.removeAttribute('indeterminate');
    await Promise.resolve();
    expect(input.matches(':indeterminate'), `${ON}: no longer mixed by the end of the microtask checkpoint`).to.equal(false);
    wrap.remove();
  });
});

describe('the keyboard: Space only, on both tags', () => {
  for (const tag of ['vera-checkbox', 'vera-switch'])
    it(`${tag}: Space toggles, Enter changes nothing`, async () => {
      const wrap = await mount(`<${tag}>${LABELED()}</${tag}>`);
      const input = wrap.querySelector('input');
      input.focus();
      await sendKeys({ press: 'Enter' });
      expect(input.checked, `${ON}: Enter`).to.equal(false);
      await sendKeys({ press: 'Space' });
      expect(input.checked, `${ON}: CONTROL: Space toggles`).to.equal(true);
      wrap.remove();
    });
});

describe('the look', () => {
  it('the input is a target of at least 24px at the page size and at a small one, and grows with a large one; the visible box is 1.125em of the page', async () => {
    const wrap = await mount(
      `<div style="font-size: 16px"><vera-checkbox>${LABELED()}</vera-checkbox><vera-switch>${LABELED()}</vera-switch></div>` +
        `<div style="font-size: 12px"><vera-checkbox>${LABELED()}</vera-checkbox><vera-switch>${LABELED()}</vera-switch></div>` +
        `<div style="font-size: 32px"><vera-checkbox>${LABELED()}</vera-checkbox></div>`,
    );
    const [check16, switch16, check12, switch12, check32] = wrap.querySelectorAll('input');
    for (const [name, input] of [['checkbox 16px', check16], ['switch 16px', switch16], ['checkbox 12px', check12], ['switch 12px', switch12]]) {
      expect(box(input).width, `${ON}: ${name} width`).to.be.at.least(24);
      expect(box(input).height, `${ON}: ${name} height`).to.be.at.least(24);
    }
    expect(check16.clientWidth, `${ON}: the visible box at 16px`).to.be.closeTo(18, 0.5);
    expect(box(check16).width, `${ON}: CONTROL: at 16px, 18px and a 4px ring a side (13px less half the box)`).to.be.closeTo(26, 0.5);
    expect(box(check32).width, `${ON}: at 32px the box is 1.5em`).to.be.closeTo(48, 0.5);
    expect(style(check16).appearance, `${ON}: CONTROL: the look applied`).to.equal('none');
    wrap.remove();
  });

  it("look none leaves the engine's own control", async () => {
    const wrap = await mount(`<vera-checkbox data-vera-look="none">${LABELED()}</vera-checkbox><vera-switch data-vera-look="none">${LABELED()}</vera-switch>`);
    for (const input of wrap.querySelectorAll('input')) {
      expect(style(input).appearance, `${ON}: no look`).to.not.equal('none');
      expect(input.getAttribute('data-vera-look'), `${ON}: CONTROL: the host's opt-out reached the input`).to.equal('none');
    }
    wrap.remove();
  });

  it("the switch's thumb sits at the inline start off and the end on, mirrored under rtl", async () => {
    const wrap = await mount(
      `<vera-switch>${LABELED()}</vera-switch><vera-switch>${LABELED(' checked')}</vera-switch>` +
        `<div dir="rtl"><vera-switch>${LABELED()}</vera-switch><vera-switch>${LABELED(' checked')}</vera-switch></div>`,
    );
    const [off, on, rtlOff, rtlOn] = [...wrap.querySelectorAll('input')].map((input) => style(input).backgroundPositionX.split(',')[0].trim());
    expect(off, `${ON}: CONTROL: off and on differ`).to.not.equal(on);
    expect(rtlOff, `${ON}: off under rtl is on's place`).to.equal(on);
    expect(rtlOn, `${ON}: on under rtl is off's place`).to.equal(off);
    wrap.remove();
  });

  it('the thumb slides, and under reduced motion it jumps', async () => {
    const wrap = await mount(`<vera-switch>${LABELED()}</vera-switch>`);
    const input = wrap.querySelector('input');
    expect(style(input).transitionDuration, `${ON}: CONTROL: it slides`).to.not.match(/^0s(, 0s)*$/);
    await emulateMedia({ reducedMotion: 'reduce' });
    try {
      expect(style(input).transitionDuration, `${ON}: reduced motion`).to.match(/^0s(, 0s)*$/);
    } finally {
      await emulateMedia({ reducedMotion: 'no-preference' });
    }
    wrap.remove();
  });

  it('forced colors: both looks keep their edge and glyph in system colors, as the engine parsed the rules', async () => {
    const wrap = await mount(`<vera-checkbox>${LABELED()}</vera-checkbox><vera-switch>${LABELED()}</vera-switch>`);
    const rules = document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules]);
    for (const mark of ['data-vera-checkbox', 'data-vera-switch']) {
      const forced = rules.filter((rule) => rule.conditionText?.includes('forced-colors') && [...rule.cssRules].some((inner) => inner.selectorText.includes(mark)));
      expect(forced.length, `${ON}: ${mark}'s forced-colors rule was kept`).to.equal(1);
      const first = forced[0].cssRules[0].style;
      /** WebKit has no forced-colors mode and does not parse the property; the engines that do keep it. */
      if (CSS.supports('forced-color-adjust', 'none')) expect(first.getPropertyValue('forced-color-adjust'), `${ON}: ${mark} keeps its own drawing`).to.equal('none');
      else expect(ENGINE?.name, `${ON}: only WebKit lacks forced-color-adjust`).to.equal('WebKit');
      expect(first.getPropertyValue('box-shadow').toLowerCase(), `${ON}: ${mark}'s edge`).to.include('buttontext');
    }
    wrap.remove();
  });
});

describe('before the script runs', () => {
  /**
   * The same markup and the same module script in a frame, sandboxed without `allow-scripts` (so the script never
   * runs; `allow-same-origin` lets this page reach in) or not sandboxed at all (the control: there it runs and serves
   * the input). The author's input is a checkbox either way: a real click checks it, the form submits its value, and
   * reset clears it.
   */
  const framed = async (sandbox) => {
    const frame = document.createElement('iframe');
    if (sandbox !== null) frame.setAttribute('sandbox', sandbox);
    frame.style.cssText = 'width: 300px; height: 120px; border: 0';
    frame.srcdoc =
      '<form><vera-checkbox><label><input type="checkbox" name="n" value="yes"> Label</label></vera-checkbox><button type="reset">Reset</button></form>' +
      "<script type=\"module\">import { wire } from '/packages/core/dist/development/vera.js';" +
      "import { renderer } from '/packages/renderer/dist/development/vera-renderer.js';" +
      "wire([renderer]); await import('/packages/components/checkbox/dist/development/vera-checkbox.js');</script>";
    const loaded = new Promise((resolve) => frame.addEventListener('load', resolve, { once: true }));
    document.body.append(frame);
    await loaded;
    return frame;
  };
  const served = async (frame) => {
    for (let i = 0; i < 100 && !frame.contentDocument.querySelector('input').hasAttribute('data-vera-checkbox'); i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    return frame.contentDocument.querySelector('input').hasAttribute('data-vera-checkbox');
  };

  it("with scripts blocked the author's input is still a checkbox: a real click checks it, the form submits its value, and reset clears it", async () => {
    const control = await framed(null);
    expect(await served(control), `${ON}: CONTROL: without the sandbox the script runs and serves the input`).to.equal(true);
    control.remove();
    const frame = await framed('allow-same-origin allow-forms');
    const doc = frame.contentDocument;
    const input = doc.querySelector('input');
    expect(await served(frame), `${ON}: the script did not run`).to.equal(false);
    const at = frame.getBoundingClientRect();
    const r = input.getBoundingClientRect();
    await sendMouse({ type: 'click', position: [Math.round(at.x + r.x + r.width / 2), Math.round(at.y + r.y + r.height / 2)] });
    expect(input.checked, `${ON}: a real click checks it`).to.equal(true);
    expect(new frame.contentWindow.FormData(doc.querySelector('form')).get('n'), `${ON}: the form submits its value`).to.equal('yes');
    const reset = doc.querySelector('button').getBoundingClientRect();
    await sendMouse({ type: 'click', position: [Math.round(at.x + reset.x + reset.width / 2), Math.round(at.y + reset.y + reset.height / 2)] });
    expect(input.checked, `${ON}: reset clears it`).to.equal(false);
    frame.remove();
  });
});

describe('vera-field', () => {
  it("inside a field, the input takes the field's label, and nothing is said", async () => {
    said.length = 0;
    const wrap = await mount('<vera-field><label>Subscribe</label><vera-checkbox><input type="checkbox"></vera-checkbox></vera-field>');
    const input = wrap.querySelector('input');
    const names = () => {
      const named = [...(input.labels ?? [])].map((label) => label.textContent.trim());
      const by = input.getAttribute('aria-labelledby');
      if (by !== null) for (const id of by.split(/\s+/)) named.push(document.getElementById(id)?.textContent.trim());
      return named;
    };
    await until(() => names().includes('Subscribe'), "the field's label names the input", 2000);
    /** A barrier: the element's development check is a 0 ms timer set when the input was served, and equal timers run in the order they were set. */
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(names(), `${ON}: the field's label names the input`).to.include('Subscribe');
    expect(said.filter((line) => line.includes('checkbox')), ON).to.deep.equal([]);
    wrap.remove();
  });
});

describe('axe', () => {
  before(async () => {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = '/node_modules/axe-core/axe.min.js';
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  });

  it('no violations over every state of both tags', async () => {
    const wrap = await mount(
      `<vera-checkbox>${LABELED()}</vera-checkbox><vera-checkbox>${LABELED(' checked')}</vera-checkbox>` +
        `<vera-checkbox indeterminate>${LABELED()}</vera-checkbox><vera-checkbox>${LABELED(' disabled')}</vera-checkbox>` +
        `<vera-switch>${LABELED()}</vera-switch><vera-switch>${LABELED(' checked')}</vera-switch><vera-switch>${LABELED(' disabled')}</vera-switch>`,
    );
    const result = await window.axe.run(wrap);
    expect(result.passes.length, `${ON}: CONTROL: axe checked something`).to.be.above(0);
    expect(
      result.violations.map((v) => `${v.id}: ${v.nodes.length}`),
      ON,
    ).to.deep.equal([]);
    wrap.remove();
  });
});
