/**
 * **<vera-input> in the three engines: what jsdom cannot answer.** Clear keeps the input's undo history (the value
 * setter, the control, loses it): a served value comes back on every engine, and typed text comes back as it does after
 * the user's own deletion in that engine; the `input` it fires is trusted; Escape on a real search input; a revealed
 * password is a password again by the time the form builds its data (`formdata`, what history and the save-password
 * prompt read). Correctness only, headless: never time with it.
 */
import { expect } from '@esm-bundle/chai';
import { emulateMedia, sendKeys, sendMouse } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/input/dist/development/vera-input.js';
import { defineAs } from '../../packages/components/input/dist/development/vera-input-element.js';
import { ON } from './engine.js';
import { until } from './until.js';

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
        // A grid: the button's inline-grid is blockified, as every item of the box (an inline-flex host) is.
        expect(getComputedStyle(clear).display, tag).to.equal('grid');
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
      '<label>Quantity <vera-input><input type="number" value="3"></vera-input></label>',
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

describe('vera-input: look v2 (scale, one clear glyph)', () => {
  const size = (wrap) => parseFloat(getComputedStyle(wrap.querySelector('input')).fontSize);

  it("scale sets the box's font size, which the input follows: md the page's, sm below it, lg above it, and none the page's too", async () => {
    const plain = await mount('<label>q <vera-input><input></vera-input></label>');
    const bare = await mount('<label>q <input></label>');
    const sm = await mount('<label>q <vera-input scale="sm"><input></vera-input></label>');
    const md = await mount('<label>q <vera-input scale="md"><input></vera-input></label>');
    const lg = await mount('<label>q <vera-input scale="lg"><input></vera-input></label>');
    const page = parseFloat(getComputedStyle(md).fontSize);
    expect(page, 'CONTROL: a font size was read').to.be.above(0);
    expect(size(md), 'md is the page\'s size').to.equal(page);
    expect(size(sm)).to.be.below(size(md));
    expect(size(lg)).to.be.above(size(md));
    expect(size(plain), 'no scale is the page\'s size too').to.equal(page);
    expect(size(bare), 'CONTROL: a bare input keeps the browser\'s own size, which differs from the page\'s').to.not.equal(page);
    for (const wrap of [plain, bare, sm, md, lg]) wrap.remove();
  });

  it('a [scale] on an ancestor (another component) does not reach our unscaled input; the mark carries the scale', async () => {
    const wrap = await mount('<div scale="lg"><label>q <vera-input><input></vera-input></label></div>');
    const control = await mount('<label>q <vera-input><input></vera-input></label>');
    expect(size(wrap)).to.equal(size(control));
    wrap.remove();
    control.remove();
  });

  it('a scaled host that opted out of the look (data-vera-look="none") keeps the browser\'s size', async () => {
    const off = await mount('<label>q <vera-input scale="lg" data-vera-look="none"><input></vera-input></label>');
    const on = await mount('<label>q <vera-input scale="lg"><input></vera-input></label>');
    const control = await mount('<label>q <vera-input><input></vera-input></label>');
    const bare = await mount('<label>q <input></label>');
    expect(size(on), 'CONTROL: the same scale without the opt-out is styled').to.be.above(size(control));
    expect(size(off), 'the opted-out input keeps the browser\'s size').to.equal(size(bare));
    for (const wrap of [off, on, control, bare]) wrap.remove();
  });

  /**
   * No engine resolves `getComputedStyle(input, '::-webkit-search-cancel-button')`: even a bare
   * `input::-webkit-search-cancel-button { appearance: none }` reads the input's own `auto` on Chromium and `''` on WebKit
   * (BROWSER-LEDGER); Firefox keeps the rule too. So the row reads what can be read, on all three engines: the engine kept the rule as written, and its subject is this
   * input exactly while our clear button is beside it. Whether the button is then painted is not read here.
   */
  it("the rule hiding the engine's own search cancel button is kept, and targets the input only while ours is beside it", async () => {
    const wrap = await mount('<label>q <vera-input clearable><input type="search" value="x"></vera-input></label>');
    const bare = await mount('<label>q <input type="search" value="x" data-vera-input></label>');
    const found = document.adoptedStyleSheets
      .flatMap((sheet) => [...sheet.cssRules])
      .find((r) => (r.selectorText ?? '').includes('::-webkit-search-cancel-button'));
    expect(found !== undefined, `CONTROL on ${ON}: the engine kept the rule`).to.equal(true);
    expect(found.style.getPropertyValue('appearance')).to.equal('none');
    const subject = found.selectorText.replace('::-webkit-search-cancel-button', '');
    const input = wrap.querySelector('input');
    expect(input.matches(subject), 'the subject is our input while clearable').to.equal(true);
    expect(bare.querySelector('input').matches(subject), 'CONTROL: a marked input with no clear button beside it is not').to.equal(false);
    wrap.querySelector('vera-input').removeAttribute('clearable');
    flush();
    await Promise.resolve();
    flush();
    expect(input.matches(subject), 'and not once clearable is removed').to.equal(false);
    wrap.remove();
    bare.remove();
  });
});

/**
 * The box is the host: a border around the input and its parts, the input borderless inside, one ring on the box while
 * the input shows focus, the danger border when invalid, dimmed when disabled, every color a shared token.
 */
describe('vera-input: the box', () => {
  const style = (node) => getComputedStyle(node);
  const px = (value) => parseFloat(value);

  it('the host is the box: its border holds the input and the clear button, the input inside is borderless (CONTROL: look none leaves the UA input)', async () => {
    const wrap = await mount('<vera-input clearable><input value="hello"></vera-input><vera-input clearable data-vera-look="none"><input value="hi"></vera-input>');
    const [on, off] = wrap.querySelectorAll('vera-input');
    const input = on.querySelector('input');
    expect(px(style(on).borderTopWidth), `${ON}: the box has a border`).to.be.at.least(1);
    expect(px(style(input).borderTopWidth), `${ON}: the input inside has none`).to.equal(0);
    const outer = on.getBoundingClientRect();
    const clear = on.querySelector('[data-vera-part="clear"]').getBoundingClientRect();
    expect(clear.width, 'CONTROL: the clear button is shown').to.be.above(0);
    expect(clear.left >= outer.left && clear.right <= outer.right && clear.top >= outer.top && clear.bottom <= outer.bottom, `${ON}: the clear button sits inside the box`).to.equal(true);
    expect(outer.height, `${ON}: the box is 2.25em tall`).to.be.closeTo(2.25 * px(style(on).fontSize), 1);
    expect(px(style(off).borderTopWidth), `${ON}: look none: no box`).to.equal(0);
    expect(px(style(off.querySelector('input')).borderTopWidth), `${ON}: look none: the input keeps its own border`).to.be.above(0);
    wrap.remove();
  });

  it('focus draws one ring, on the box: a 2px solid outline offset 2px, and none on the input; it goes with the focus', async () => {
    const wrap = await mount('<vera-input><input></vera-input><button>after</button>');
    const host = wrap.querySelector('vera-input');
    const input = host.querySelector('input');
    expect(style(host).outlineStyle, 'CONTROL: no ring before focus').to.equal('none');
    input.focus();
    expect(style(host).outlineStyle, `${ON}: the box's ring`).to.equal('solid');
    expect(px(style(host).outlineWidth), `${ON}: 2px`).to.equal(2);
    expect(px(style(host).outlineOffset), `${ON}: offset 2px`).to.equal(2);
    expect(style(input).outlineStyle, `${ON}: no second ring on the input`).to.equal('none');
    wrap.querySelector('button').focus();
    expect(style(host).outlineStyle, `${ON}: the ring goes with the focus`).to.equal('none');
    wrap.remove();
    const clearable = await mount('<vera-input clearable><input value="x"></vera-input>');
    clearable.querySelector('[data-vera-part="clear"]').focus();
    expect(style(clearable.querySelector('vera-input')).outlineStyle, `${ON}: focus on the clear button rings the box too`).to.equal('solid');
    clearable.remove();
  });

  /**
   * `:user-invalid` needs a change the user committed: typing and deleting back to the initial value commits none
   * (Chromium kept the box valid that way), so the user types a value that is not an email and leaves the field.
   */
  it('the border is --vera-danger on aria-invalid="true" and once the user has left an invalid value (CONTROL: before, and valid, it is not)', async () => {
    const wrap = await mount('<div style="--vera-danger: rgb(1, 2, 3)"><vera-input><input aria-invalid="true"></vera-input><vera-input><input type="email"></vera-input><vera-input><input></vera-input><button>after</button></div>');
    const [marked, email, valid] = wrap.querySelectorAll('vera-input');
    expect(style(marked).borderTopColor, `${ON}: aria-invalid`).to.equal('rgb(1, 2, 3)');
    expect(style(valid).borderTopColor, 'CONTROL: a valid box is not the danger color').to.not.equal('rgb(1, 2, 3)');
    expect(style(email).borderTopColor, 'CONTROL: untouched, it is not yet invalid to the user').to.not.equal('rgb(1, 2, 3)');
    email.querySelector('input').focus();
    await sendKeys({ type: 'x' });
    expect(email.querySelector('input').validity.typeMismatch, 'CONTROL: the value is invalid').to.equal(true);
    wrap.querySelector('button').focus();
    // The border color transitions (150ms), so the computed color is read once it has arrived, not mid-way.
    await until(() => style(email).borderTopColor === 'rgb(1, 2, 3)', `${ON}: an invalid value the user left (:user-invalid) turns the border`, 2000);
    wrap.remove();
  });

  it("a page's ordinary input rules draw no box inside the box and do not fix its size (CONTROL: under look none they apply)", async () => {
    const page = document.createElement('style');
    page.textContent = 'input { border: 3px solid red; padding: 9px; font-size: 15px; background: yellow } .page :where(input) { border-width: 4px } .form-control { border: 5px solid blue }';
    document.head.append(page);
    const wrap = await mount('<div class="page"><vera-input scale="sm"><input class="form-control"></vera-input><vera-input scale="lg"><input></vera-input><vera-input data-vera-look="none"><input></vera-input></div>');
    const [sm, lg, off] = wrap.querySelectorAll('vera-input');
    const inner = (host) => style(host.querySelector('input'));
    expect(px(inner(sm).borderTopWidth), `${ON}: no border inside the box, a class on the input included`).to.equal(0);
    expect(inner(sm).backgroundColor, `${ON}: no page background inside the box`).to.equal('rgba(0, 0, 0, 0)');
    expect(px(inner(lg).fontSize), `${ON}: the page's font size does not fix the input's: lg is larger than sm`).to.be.above(px(inner(sm).fontSize));
    expect(px(inner(off).borderTopWidth), "CONTROL: look none: the page's rules apply").to.be.above(0);
    page.remove();
    wrap.remove();
  });

  it('development warns when a page rule stronger than the reset draws a border inside the box (CONTROL: an ordinary page says nothing)', async () => {
    const said = [];
    const original = console.warn;
    console.warn = (...args) => said.push(args.join(' '));
    const page = document.createElement('style');
    page.textContent = '#strong input { border: 2px solid red }';
    document.head.append(page);
    try {
      const quiet = await mount('<label>q <vera-input><input></vera-input></label>');
      const strong = await mount('<div id="strong"><label>q <vera-input><input></vera-input></label></div>');
      await until(() => said.some((line) => line.includes('input-inner-border')), `${ON}: the warning for the box under the stronger rule`, 2000);
      const inner = said.filter((line) => line.includes('input-inner-border'));
      expect(inner.length, `${ON}: one warning, for the box under the stronger rule (said: ${said.join(' | ')})`).to.equal(1);
      expect(inner[0].startsWith('[vera]'), 'the convention prefix').to.equal(true);
      quiet.remove();
      strong.remove();
    } finally {
      console.warn = original;
      page.remove();
    }
  });

  it('a disabled input dims the box', async () => {
    const wrap = await mount('<vera-input><input disabled></vera-input><vera-input><input></vera-input>');
    const [disabled, enabled] = wrap.querySelectorAll('vera-input');
    expect(px(style(disabled).opacity), `${ON}: dimmed`).to.equal(0.5);
    expect(px(style(enabled).opacity), 'CONTROL: enabled is not').to.equal(1);
    wrap.remove();
  });

  it('every color and the radius are the shared tokens: an app sets them once and the box follows', async () => {
    const tokens = '--vera-border-control: rgb(4, 5, 6); --vera-surface: rgb(7, 8, 9); --vera-fg: rgb(10, 11, 12); --vera-radius: 3px';
    const wrap = await mount(`<div style="${tokens}"><vera-input><input></vera-input></vera-input></div><vera-input><input></vera-input>`);
    const [themed, plain] = wrap.querySelectorAll('vera-input');
    expect(style(themed).borderTopColor, `${ON}: border`).to.equal('rgb(4, 5, 6)');
    expect(style(themed).backgroundColor, `${ON}: surface`).to.equal('rgb(7, 8, 9)');
    expect(style(themed.querySelector('input')).color, `${ON}: text, inherited by the input`).to.equal('rgb(10, 11, 12)');
    expect(style(themed).borderTopLeftRadius, `${ON}: radius`).to.equal('3px');
    expect(style(plain).borderTopColor, 'CONTROL: unset, the default is not the themed value').to.not.equal('rgb(4, 5, 6)');
    wrap.remove();
  });

  it('dark scheme with no tokens set: the text on the box is at least 4.5:1 and its edge at least 3:1, in both schemes, and the two differ', async () => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const lum = (rgb) => {
      const [r, g, b] = rgb.match(/[\d.]+/g).slice(0, 3).map((v) => lin(Number(v) / 255));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a, b) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(ratio('rgb(0, 0, 0)', 'rgb(255, 255, 255)'), 'CONTROL: the ratio reads 21 for black on white').to.be.closeTo(21, 0.01);
    const wrap = await mount('<div style="color-scheme: light"><vera-input><input></vera-input></div><div style="color-scheme: dark"><vera-input><input></vera-input></div>');
    const [light, dark] = wrap.querySelectorAll('vera-input');
    for (const [name, host] of [['light', light], ['dark', dark]]) {
      const text = style(host.querySelector('input')).color;
      expect(ratio(text, style(host).backgroundColor), `${ON}: ${name}: text on the box (${text} on ${style(host).backgroundColor})`).to.be.at.least(4.5);
      expect(ratio(style(host).borderTopColor, style(host).backgroundColor), `${ON}: ${name}: the box's edge on its surface (${style(host).borderTopColor} on ${style(host).backgroundColor}, WCAG 1.4.11)`).to.be.at.least(3);
    }
    expect(style(dark).backgroundColor, `${ON}: the dark box is not the light one`).to.not.equal(style(light).backgroundColor);
    wrap.remove();
  });

  it('forced colors: the ring is Highlight, as the engine parsed the rule (this runner has no forced-colors emulation)', async () => {
    const wrap = await mount('<vera-input><input></vera-input>');
    const rules = document.adoptedStyleSheets.flatMap((sheet) => [...sheet.cssRules]);
    const forced = rules.filter((rule) => rule.conditionText?.includes('forced-colors') && [...rule.cssRules].some((inner) => inner.selectorText.includes('data-vera-input-host')));
    expect(forced.length, `${ON}: the box's forced-colors rule was kept`).to.equal(1);
    expect(forced[0].cssRules[0].style.getPropertyValue('outline-color').toLowerCase(), `${ON}: Highlight`).to.equal('highlight');
    wrap.remove();
  });
});

describe('vera-input: the stepper, on a number input', () => {
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
    await new Promise((resolve) => setTimeout(resolve, 200));
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

describe('vera-input: a pointer clear keeps focus in the input', () => {
  it('a real click on the clear button never blurs the input: focus stays, the value clears, no blur fires', async () => {
    const wrap = await mount('<label>q <vera-input clearable><input value="hello"></vera-input></label>');
    const input = wrap.querySelector('input');
    const button = wrap.querySelector('[data-vera-part="clear"]');
    input.focus();
    expect(document.activeElement, 'CONTROL: the input had focus').to.equal(input);
    let blurs = 0;
    input.addEventListener('blur', () => blurs++);
    const box = button.getBoundingClientRect();
    expect(box.width, 'CONTROL: the clear button is shown').to.be.above(0);
    await sendMouse({ type: 'click', position: [Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2)] });
    expect(input.value, 'the click reached the button').to.equal('');
    expect(blurs, 'blur events on the input').to.equal(0);
    expect(document.activeElement).to.equal(input);
    await sendMouse({ type: 'move', position: [0, 0] });
    wrap.remove();
  });
});
