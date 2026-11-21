/**
 * **<vera-input> in the three engines: what jsdom cannot answer.** Clear keeps the input's undo history (the value
 * setter, the control, loses it), and the `input` it fires is trusted; Escape on a real search input; a revealed
 * password is a password again by the time the form builds its data (`formdata`, what history and the save-password
 * prompt read). Correctness only, headless: never time with it.
 */
import { expect } from '@esm-bundle/chai';
import { emulateMedia, sendKeys } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/input/dist/development/vera-input.js';
import { defineAs } from '../../packages/components/input/dist/development/vera-input-element.js';

wire([renderer]);
defineAs('my-input');

const mount = async (inner) => {
  const wrap = document.createElement('div');
  wrap.innerHTML = inner;
  document.body.append(wrap);
  flush();
  await Promise.resolve();
  flush();
  return wrap;
};
/** Undo, as the platform spells it: Meta on Apple engines, Control elsewhere. */
const undo = () => sendKeys({ press: 'ControlOrMeta+z' });

describe('vera-input', () => {
  it('CONTROL: text cleared through the value setter does not come back with undo (the instrument can tell)', async () => {
    const wrap = await mount('<label>q <input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ type: 'hello' });
    input.value = '';
    await undo();
    expect(input.value).to.equal('');
    wrap.remove();
  });

  it('clear keeps the undo history: Ctrl/Cmd+Z brings the text back', async () => {
    const wrap = await mount('<label>q <vera-input clearable><input></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ type: 'hello' });
    wrap.querySelector('[data-vera-part="clear"]').click();
    expect(input.value).to.equal('');
    expect(document.activeElement).to.equal(input);
    await undo();
    expect(input.value).to.equal('hello');
    wrap.remove();
  });

  it("clear's input event is trusted, deleteContentBackward, as a framework reads typing", async () => {
    const wrap = await mount('<label>q <vera-input clearable><input value="hello"></vera-input></label>');
    const input = wrap.querySelector('input');
    const seen = [];
    input.addEventListener('input', (event) => seen.push([event.isTrusted, event.inputType]));
    wrap.querySelector('[data-vera-part="clear"]').click();
    expect(seen).to.deep.equal([[true, 'deleteContentBackward']]);
    wrap.remove();
  });

  it('Escape clears a search input once, keeps its undo, and is not left to the engine', async () => {
    const wrap = await mount('<label>q <vera-input clearable><input type="search"></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ type: 'hello' });
    const seen = [];
    input.addEventListener('input', (event) => seen.push(event.inputType));
    await sendKeys({ press: 'Escape' });
    expect(input.value).to.equal('');
    expect(seen).to.deep.equal(['deleteContentBackward']);
    await undo();
    expect(input.value).to.equal('hello');
    wrap.remove();
  });

  it('a revealed password is a password again when the form builds its data', async () => {
    const wrap = await mount(
      '<iframe name="sink" hidden></iframe><form target="sink" action="about:blank"><label>Password <vera-input reveal><input name="p" type="password" value="s3cret"></vera-input></label></form>',
    );
    const form = wrap.querySelector('form');
    const input = wrap.querySelector('input');
    wrap.querySelector('[data-vera-part="reveal"]').click();
    expect(input.type).to.equal('text');
    const atData = new Promise((resolve) => form.addEventListener('formdata', () => resolve(input.type), { once: true }));
    form.requestSubmit();
    expect(await atData).to.equal('password');
    wrap.remove();
  });

  it('before upgrade (a tag never defined, as with no script): the input is focusable and submits its value', async () => {
    const wrap = await mount(
      '<iframe name="nojs" hidden></iframe><form target="nojs" action="about:blank"><label>Amount <vera-input-never-defined><span data-vera-part="prefix">$</span><input name="amount" value="5"></vera-input-never-defined></label></form>',
    );
    const form = wrap.querySelector('form');
    const input = wrap.querySelector('input');
    input.focus();
    expect(document.activeElement).to.equal(input);
    const data = new Promise((resolve) => form.addEventListener('formdata', (event) => resolve(event.formData.get('amount')), { once: true }));
    form.requestSubmit();
    expect(await data).to.equal('5');
    wrap.remove();
  });

  describe('the look (styles not wired: the element adopts its own rule)', () => {
    const glyph = (node) => getComputedStyle(node, '::before').content;

    it("CONTROL, and the collision row: another component's part of the same name gets none of input's look", async () => {
      const ours = await mount('<label>q <vera-input clearable><input value="x"></vera-input></label>');
      const wrap = await mount('<button aria-label="Clear" data-vera-part="clear"></button>');
      expect(glyph(wrap.querySelector('button'))).to.be.oneOf(['none', 'normal']);
      expect(glyph(ours.querySelector('[data-vera-part="clear"]')), 'positive control: the rule is in the document').to.include('\u00d7');
      wrap.remove();
      ours.remove();
    });

    it('clear shows its glyph and hides with [hidden]; under a tag of the caller\'s own too', async () => {
      for (const tag of ['vera-input', 'my-input']) {
        const wrap = await mount(`<label>q <${tag} clearable><input value="x"></${tag}></label>`);
        const clear = wrap.querySelector('[data-vera-part="clear"]');
        expect(glyph(clear), tag).to.include('\u00d7');
        expect(getComputedStyle(clear).display, tag).to.equal('inline-grid');
        wrap.querySelector('input').value = '';
        wrap.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
        expect(clear.hidden, tag).to.equal(true);
        expect(getComputedStyle(clear).display, tag).to.equal('none');
        wrap.remove();
      }
    });

    it("a page's own class on a part wins over the look (zero specificity)", async () => {
      const style = document.createElement('style');
      style.textContent = '.wide{inline-size:40px}';
      document.head.append(style);
      const wrap = await mount('<label>q <vera-input clearable><input value="x"></vera-input></label>');
      const clear = wrap.querySelector('[data-vera-part="clear"]');
      clear.classList.add('wide');
      expect(getComputedStyle(clear).inlineSize).to.equal('40px');
      wrap.remove();
      style.remove();
    });

    it('data-vera-look="none" on the host or on a part drops the look; the part stays', async () => {
      const host = await mount('<label>q <vera-input clearable data-vera-look="none"><input value="x"></vera-input></label>');
      const a = host.querySelector('[data-vera-part="clear"]');
      expect(glyph(a)).to.be.oneOf(['none', 'normal']);
      expect(getComputedStyle(a).display).to.equal('inline-block');
      host.remove();
      const own = await mount('<label>q <vera-input clearable><input value="x"></vera-input></label>');
      const b = own.querySelector('[data-vera-part="clear"]');
      b.setAttribute('data-vera-look', 'none');
      expect(glyph(b)).to.be.oneOf(['none', 'normal']);
      own.remove();
    });

    it('loading turns, and under reduced motion pulses instead (never nothing)', async () => {
      const wrap = await mount('<label>q <vera-input loading><input></vera-input></label>');
      const mark = wrap.querySelector('[data-vera-part="loading"]');
      expect(getComputedStyle(mark).animationName).to.equal('vera-input-turn');
      await emulateMedia({ reducedMotion: 'reduce' });
      try {
        expect(getComputedStyle(mark).animationName).to.equal('vera-input-pulse');
      } finally {
        await emulateMedia({ reducedMotion: 'no-preference' });
      }
      wrap.remove();
    });
  });
});
