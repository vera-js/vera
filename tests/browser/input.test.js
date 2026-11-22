/**
 * **<vera-input> in the three engines: what jsdom cannot answer.** Clear keeps the input's undo history (the value
 * setter, the control, loses it): a served value comes back on every engine, and typed text comes back as it does after
 * the user's own deletion in that engine; the `input` it fires is trusted; Escape on a real search input; a revealed
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

/**
 * Playwright's WebKit on a Mac platform: the one place the user's own deletion was measured to undo to empty, and
 * not every time (1 run in 10 alone, and one in a full suite, brought "hello" back). Its UA also says macOS on
 * Windows, so the checks below are loose there too (never falsely red); Chromium and Firefox stay strict.
 */
const ua = navigator.userAgent;
const macWebKit = /AppleWebKit/.test(ua) && !/Chrome/.test(ua) && navigator.platform.startsWith('Mac');

/**
 * What undo brings back after clearing text just typed: "hello", as after the user's own deletion, except on macOS
 * WebKit, where a delete that follows typing joins the typing's undo step at some runs and not at others, for the
 * user's own Backspace as for clear, so either answer is the platform's there.
 */
const expectUndoneAsOwnDeletion = (value) => {
  expect(['hello', '']).to.include(value);
  if (!macWebKit) expect(value).to.equal('hello');
};

/**
 * The user's OWN deletion of text they just typed (select all, then Backspace, sent as keys), undone: the behavior
 * clear promises to match. The pin makes Chromium and Firefox bring "hello" back, so the clear rows' strictness there
 * rests on a measured platform answer, not on an assumption.
 */
const ownDeletionUndo = async () => {
  const wrap = await mount('<label>n <input></label>');
  const input = wrap.querySelector('input');
  input.focus();
  await sendKeys({ type: 'hello' });
  await sendKeys({ press: 'ControlOrMeta+a' });
  await sendKeys({ press: 'Backspace' });
  expect(input.value).to.equal('');
  await undo();
  const restored = input.value;
  wrap.remove();
  expect(['hello', '']).to.include(restored);
  const pin = 'PIN: off macOS WebKit, the user\'s own deletion undoes back to "hello"';
  if (!macWebKit) expect(restored, pin).to.equal('hello');
};

describe('vera-input', () => {
  it('CONTROL: a served value cleared through the value setter does not come back with undo (the instrument can tell)', async () => {
    const wrap = await mount('<label>q <input value="hello"></label>');
    const input = wrap.querySelector('input');
    input.focus();
    input.value = '';
    await undo();
    expect(input.value).to.equal('');
    wrap.remove();
  });

  it('clear keeps the undo history: Ctrl/Cmd+Z brings a served value back', async () => {
    const wrap = await mount('<label>q <vera-input clearable><input value="hello"></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    wrap.querySelector('[data-vera-part="clear"]').click();
    expect(input.value).to.equal('');
    expect(document.activeElement).to.equal(input);
    await undo();
    expect(input.value).to.equal('hello');
    wrap.remove();
  });

  it("clear of typed text undoes as the user's own deletion does (on macOS WebKit: membership only)", async () => {
    await ownDeletionUndo();
    const wrap = await mount('<label>q <vera-input clearable><input></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ type: 'hello' });
    wrap.querySelector('[data-vera-part="clear"]').click();
    expect(input.value).to.equal('');
    await undo();
    expectUndoneAsOwnDeletion(input.value);
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
    const wrap = await mount('<label>q <vera-input clearable><input type="search" value="hello"></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    const seen = [];
    input.addEventListener('input', (event) => seen.push(event.inputType));
    await sendKeys({ press: 'Escape' });
    expect(input.value).to.equal('');
    expect(seen).to.deep.equal(['deleteContentBackward']);
    await undo();
    expect(input.value).to.equal('hello');
    wrap.remove();
  });

  it("Escape on typed search text undoes as the user's own deletion does (on macOS WebKit: membership only)", async () => {
    await ownDeletionUndo();
    const wrap = await mount('<label>q <vera-input clearable><input type="search"></vera-input></label>');
    const input = wrap.querySelector('input');
    input.focus();
    await sendKeys({ type: 'hello' });
    await sendKeys({ press: 'Escape' });
    expect(input.value).to.equal('');
    await undo();
    expectUndoneAsOwnDeletion(input.value);
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

const axeReady = new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/node_modules/axe-core/axe.min.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});
const violations = async (node) => {
  await axeReady;
  const { violations: found } = await globalThis.axe.run(node, { resultTypes: ['violations'] });
  return found.map((v) => v.id);
};

describe('vera-input: axe in every state', () => {
  it('CONTROL: axe reports an input with no name', async () => {
    const wrap = await mount('<vera-input clearable><input value="x"></vera-input>');
    expect(await violations(wrap)).to.include('label');
    wrap.remove();
  });

  it('no violation in any state', async () => {
    const states = [
      '<label>Search <vera-input clearable><input type="search" value="vera"></vera-input></label>',
      '<label>Search <vera-input clearable><input type="search"></vera-input></label>',
      '<label>Amount <vera-input><span data-vera-part="prefix">$</span><input value="12"><span data-vera-part="suffix">.00</span></vera-input></label>',
      '<label>Password <vera-input reveal caps-lock-hint><input type="password" value="s3cret"></vera-input></label>',
      '<label>Email <vera-input loading><input type="email"></vera-input></label>',
      '<label>Default <vera-input name="d" clearable value="x"></vera-input></label>',
      '<fieldset disabled><legend>Off</legend><label>Disabled <vera-input clearable><input value="x"></vera-input></label></fieldset>',
    ];
    for (const markup of states) {
      const wrap = await mount(markup);
      const reveal = wrap.querySelector('[data-vera-part="reveal"]');
      expect(await violations(wrap), markup).to.deep.equal([]);
      if (reveal !== null) {
        reveal.click();
        expect(await violations(wrap), `${markup} (revealed)`).to.deep.equal([]);
      }
      wrap.remove();
    }
  });
});

describe('vera-input: realm', () => {
  it("in an iframe, where execCommand refuses, the fallback's events are the iframe's own classes", async () => {
    const frame = document.createElement('iframe');
    document.body.append(frame);
    await new Promise((resolve) => (frame.contentDocument?.readyState === 'complete' ? resolve() : frame.addEventListener('load', resolve, { once: true })));
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    doc.execCommand = () => false;
    const wrap = await mount('<label>q <vera-input clearable><input value="hello"></vera-input></label>');
    const host = wrap.querySelector('vera-input');
    doc.body.append(doc.adoptNode(wrap));
    flush();
    await Promise.resolve();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = host.querySelector('input');
    const seen = [];
    input.addEventListener('input', (event) => seen.push(['input', event instanceof win.InputEvent, event instanceof InputEvent]));
    input.addEventListener('change', (event) => seen.push(['change', event instanceof win.Event, event instanceof Event]));
    host.querySelector('[data-vera-part="clear"]').click();
    expect(input.value).to.equal('');
    expect(seen).to.deep.equal([['input', true, false], ['change', true, false]]);
    frame.remove();
  });
});

describe('vera-input: upgraded by the parser before its children exist', () => {
  it("the parser connects the host first (definition already run); the user's input takes over and the form has only it", async () => {
    const frame = document.createElement('iframe');
    frame.srcdoc = `<!doctype html><body><script type="module">
      import { flush, wire } from '/packages/core/dist/development/vera.js';
      import { renderer } from '/packages/renderer/dist/development/vera-renderer.js';
      import '/packages/components/input/dist/development/vera-input.js';
      wire([renderer]);
      window.veraFlush = flush;
      window.parent.postMessage('defined', '*');
    </script></body>`;
    const defined = new Promise((resolve) => window.addEventListener('message', (event) => event.data === 'defined' && resolve(), { once: true }));
    document.body.append(frame);
    await defined;
    const win = frame.contentWindow;
    const doc = frame.contentDocument;
    doc.open();
    doc.write('<form><label>Search <vera-input clearable>');
    const host = doc.querySelector('vera-input');
    const early = host !== null && host.matches(':defined') && host.querySelector('input:not([data-vera-part])') === null;
    win.veraFlush();
    doc.write('<input name="q" value="x"></vera-input></label></form>');
    doc.close();
    await new Promise((resolve) => win.setTimeout(resolve, 0));
    win.veraFlush();
    await new Promise((resolve) => win.setTimeout(resolve, 0));
    const inputs = [...host.querySelectorAll('input')].map((input) => input.getAttribute('name') ?? '(default)');
    const keys = [...new win.FormData(doc.querySelector('form')).keys()].join(',');
    const after = host.querySelector('[data-vera-part="clear"]')?.previousElementSibling?.getAttribute('name') ?? null;
    frame.remove();
    expect(early, 'CONTROL: the host was upgraded before its input was parsed').to.equal(true);
    expect(inputs.join(',')).to.equal('q');
    expect(keys).to.equal('q');
    expect(after).to.equal('q');
  });
});
