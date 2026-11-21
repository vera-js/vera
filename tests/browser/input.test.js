/**
 * **<vera-input> in the three engines: what jsdom cannot answer.** Clear keeps the input's undo history (the value
 * setter, the control, loses it), and the `input` it fires is trusted; Escape on a real search input; a revealed
 * password is a password again by the time the form builds its data (`formdata`, what history and the save-password
 * prompt read). Correctness only, headless: never time with it.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/input/dist/development/vera-input.js';

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
});
