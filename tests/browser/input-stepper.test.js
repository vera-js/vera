/**
 * **`@vera-components/input/stepper`** on real engines: with the module wired, a number input's engine spinner is hidden
 * and the step parts step it. The file wires the module itself, after its first row: an input served before
 * `wire([stepper])` keeps the native spinner (the documented order), and every row after is wired.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys, sendMouse } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/input/dist/development/vera-input.js';
import { stepper } from '../../packages/components/input/dist/development/vera-input-stepper.js';
import { ON } from './engine.js';
import { until } from './until.js';

wire([renderer]);

const mount = async (inner) => {
  const wrap = document.createElement('div');
  wrap.innerHTML = inner;
  document.body.append(wrap);
  flush();
  await Promise.resolve();
  flush();
  return wrap;
};

describe('vera-input: the stepper is wired before the inputs it serves', () => {
  it('an input served before wire([stepper]) keeps the native spinner; one served after gets the stepper', async () => {
    const before = await mount('<label>a <vera-input><input type="number"></vera-input></label>');
    expect(before.querySelector('[data-vera-part="stepper"]'), 'CONTROL: not wired, no stepper').to.equal(null);
    wire([stepper]);
    const after = await mount('<label>b <vera-input><input type="number"></vera-input></label>');
    expect(after.querySelector('[data-vera-part="step-up"]'), `${ON}: served after the wiring, it has the stepper`).to.not.equal(null);
    const stepRules = document.adoptedStyleSheets.some((sheet) => [...sheet.cssRules].some((rule) => rule.cssText.includes('step-up')));
    expect(stepRules, `${ON}: the stepper adopted its rules (the read input's own file holds to false without the module)`).to.equal(true);
    expect(before.querySelector('[data-vera-part="stepper"]'), `${ON}: served before, it keeps the native spinner (the documented order)`).to.equal(null);
    expect(getComputedStyle(before.querySelector('input')).appearance, `${ON}: and the native spinner is not hidden on it`).to.not.equal('textfield');
    before.remove();
    after.remove();
  });
});

describe('vera-input: the stepper, wired', () => {
  const style = (node) => getComputedStyle(node);
  const center = (node) => {
    const r = node.getBoundingClientRect();
    return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)];
  };
  /** A real pointer press on `node`, held `ms` before release. */
  const press = async (node, ms = 0) => {
    await sendMouse({ type: 'move', position: center(node) });
    await sendMouse({ type: 'down' });
    if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
    await sendMouse({ type: 'up' });
    await sendMouse({ type: 'move', position: [0, 0] });
  };
  const count = (input) => {
    const seen = { input: 0, change: 0 };
    input.addEventListener('input', () => seen.input++);
    input.addEventListener('change', () => seen.change++);
    return seen;
  };

  it('a press on step-up steps by the step, fires input once and change once, keeps focus in the input, and stops at max', async () => {
    const wrap = await mount('<label>n <vera-input><input type="number" value="10" step="5" max="20"></vera-input></label>');
    const input = wrap.querySelector('input');
    const up = wrap.querySelector('[data-vera-part="step-up"]');
    expect(up, `${ON}: a number input gets the stepper`).to.not.equal(null);
    input.focus();
    const seen = count(input);
    await press(up);
    expect(input.value, `${ON}: one step of 5`).to.equal('15');
    expect(seen, `${ON}: one input, one change`).to.deep.equal({ input: 1, change: 1 });
    expect(document.activeElement, `${ON}: focus stays in the input`).to.equal(input);
    await press(up);
    await press(up);
    expect(input.value, `${ON}: clamped at max`).to.equal('20');
    expect(seen, `${ON}: the step past max fired nothing`).to.deep.equal({ input: 2, change: 2 });
    await press(wrap.querySelector('[data-vera-part="step-down"]'));
    expect(input.value, `${ON}: step-down steps down`).to.equal('15');
    wrap.remove();
  });

  it('held, it repeats after a pause; change fires once, at release (CONTROL: a short press steps once)', async () => {
    const wrap = await mount('<label>n <vera-input><input type="number" value="0"></vera-input></label>');
    const input = wrap.querySelector('input');
    const up = wrap.querySelector('[data-vera-part="step-up"]');
    const seen = count(input);
    await press(up);
    expect(input.value, 'CONTROL: a short press steps once').to.equal('1');
    await press(up, 900);
    expect(Number(input.value), `${ON}: held, it repeated`).to.be.above(3);
    expect(seen.change, `${ON}: one change per press`).to.equal(2);
    const after = input.value;
    /** A sentinel three repeat periods later: a repeat still running would have stepped by then. */
    let later = false;
    setTimeout(() => (later = true), 180);
    await until(() => later, 'the sentinel fired', 2000);
    expect(input.value, `${ON}: the repeat stopped at release`).to.equal(after);
    wrap.remove();
  });

  it('a disabled or read-only input steps nothing (CONTROL: an enabled one steps)', async () => {
    const wrap = await mount('<label>a <vera-input><input type="number" value="1" disabled></vera-input></label><label>b <vera-input><input type="number" value="1" readonly></vera-input></label><label>c <vera-input><input type="number" value="1"></vera-input></label>');
    const [disabled, readonly, enabled] = wrap.querySelectorAll('vera-input');
    for (const host of [disabled, readonly, enabled]) await press(host.querySelector('[data-vera-part="step-up"]'));
    expect(enabled.querySelector('input').value, 'CONTROL: enabled steps').to.equal('2');
    expect(disabled.querySelector('input').value, `${ON}: disabled`).to.equal('1');
    expect(readonly.querySelector('input').value, `${ON}: read-only`).to.equal('1');
    wrap.remove();
  });

  it("under the look the engine's spinner is hidden and the parts sit inside the box, each at least 24px, the box as tall as a text box (CONTROL: look none keeps the engine's)", async () => {
    const wrap = await mount('<div style="font-size: 16px"><vera-input><input type="number"></vera-input><vera-input><input></vera-input><vera-input data-vera-look="none"><input type="number"></vera-input></div>');
    const [number, text, off] = wrap.querySelectorAll('vera-input');
    expect(text.querySelector('[data-vera-part="stepper"]'), 'CONTROL: a text input gets no stepper').to.equal(null);
    expect(style(number.querySelector('input')).appearance, `${ON}: the spinner is hidden`).to.equal('textfield');
    expect(style(off.querySelector('input')).appearance, "CONTROL: look none keeps the engine's").to.not.equal('textfield');
    const box = number.getBoundingClientRect();
    for (const name of ['step-down', 'step-up']) {
      const r = number.querySelector(`[data-vera-part="${name}"]`).getBoundingClientRect();
      expect(r.width, `${ON}: ${name} is at least 24px wide`).to.be.at.least(24);
      expect(r.height, `${ON}: ${name} is at least 24px tall`).to.be.at.least(24);
      expect(r.left >= box.left && r.right <= box.right && r.top >= box.top && r.bottom <= box.bottom, `${ON}: ${name} sits inside the box`).to.equal(true);
    }
    expect(box.height, `${ON}: as tall as a text box`).to.be.closeTo(text.getBoundingClientRect().height, 0.5);
    wrap.remove();
  });

  it('each step part draws its glyph in the text color, one bar for step-down and two for step-up; the parts of an off input take its cursor (CONTROL: look none draws none)', async () => {
    const wrap = await mount('<vera-input><input type="number"></vera-input><vera-input><input type="number" disabled></vera-input><vera-input data-vera-look="none"><input type="number"></vera-input>');
    const [on, off, none] = wrap.querySelectorAll('vera-input');
    const bars = (host, name) => (style(host.querySelector(`[data-vera-part="${name}"]`)).backgroundImage.match(/gradient/g) ?? []).length;
    expect(bars(none, 'step-up'), 'CONTROL: look none draws no glyph').to.equal(0);
    expect(bars(on, 'step-down'), `${ON}: step-down, one bar`).to.equal(1);
    expect(bars(on, 'step-up'), `${ON}: step-up, two bars`).to.equal(2);
    expect(style(on.querySelector('[data-vera-part="step-up"]')).cursor, 'CONTROL: an enabled part is a pointer').to.equal('pointer');
    expect(style(off.querySelector('[data-vera-part="step-up"]')).cursor, `${ON}: a disabled input's part takes the box's cursor`).to.equal('not-allowed');
    wrap.remove();
  });

  it('the stepper is aria-hidden and never focused: the keyboard steps the input itself', async () => {
    const wrap = await mount('<label>n <vera-input><input type="number" value="1"></vera-input></label>');
    const stepper = wrap.querySelector('[data-vera-part="stepper"]');
    expect(stepper.getAttribute('aria-hidden'), `${ON}: aria-hidden`).to.equal('true');
    expect(stepper.querySelector('[tabindex]'), `${ON}: nothing in it is focusable`).to.equal(null);
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ press: 'ArrowUp' });
    expect(input.value, 'CONTROL: the keyboard steps the input').to.equal('2');
    wrap.remove();
  });
});
