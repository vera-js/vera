/**
 * **<vera-kbd> in the three engines, with `@verajs/styles` NOT wired**: the rule that speaks a symbol's word is adopted
 * by the element itself into whichever root it renders in (the document, someone's shadow root, a shadow root moved
 * into another document), and what a selection of ⇧⌘K holds is exactly what is shown. Correctness only, headless.
 * The rule's effect is read as the computed `content` of a symbol key's `::before`, which carries the word as alt text.
 */
import { expect } from '@esm-bundle/chai';
import { emulateMedia } from '@web/test-runner-commands';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/kbd/dist/development/vera-kbd.js';
import { defineAs } from '../../packages/components/kbd/dist/development/vera-kbd-element.js';
import { ENGINE, ON } from './engine.js';

wire([renderer]);
defineAs('my-kbd');

const frame = (win = window) => new Promise((resolve) => win.requestAnimationFrame(() => setTimeout(resolve, 0)));
const iframeReady = async () => {
  const f = document.createElement('iframe');
  document.body.append(f);
  await new Promise((r) => (f.contentDocument?.readyState === 'complete' ? r() : f.addEventListener('load', r, { once: true })));
  return f;
};
/** The `::before` content of `kbd`'s first symbol key, read in the key's own window. */
const spoken = (kbd) => {
  const key = kbd.querySelector('[data-vera-word]');
  return key.ownerDocument.defaultView.getComputedStyle(key, '::before').content;
};
/** The rules of a sheet and of every grouping rule (`@layer`, `@media`) inside it, flattened. */
const rulesOf = (list) => [...list].flatMap((rule) => [rule, ...(rule.cssRules ? rulesOf(rule.cssRules) : [])]);
/** How many of `root`'s adopted sheets carry kbd's words rule, found by kbd's own mark in the selector. */
const kbdSheets = (root = document) =>
  root.adoptedStyleSheets.filter((sheet) => rulesOf(sheet.cssRules).some((rule) => rule.selectorText?.includes('data-vera-kbd'))).length;
const make = (doc = document) => {
  const kbd = doc.createElement('vera-kbd');
  kbd.setAttribute('keys', 'Mod+Shift+K');
  kbd.setAttribute('platform', 'apple');
  return kbd;
};

describe('vera-kbd: the words rule, unwired styles', () => {
  it('CONTROL: a symbol key with no rule has no generated content', async () => {
    const key = document.createElement('kbd');
    key.setAttribute('data-vera-word', 'Shift');
    document.body.append(key);
    expect(getComputedStyle(key, '::before').content).to.be.oneOf(['none', 'normal']);
    key.remove();
  });

  it('in the document: the word rule applies, and it is adopted once however many kbds render', async () => {
    const a = make();
    const b = make();
    document.body.append(a, b);
    flush();
    await frame();
    expect(spoken(a), 'positive control: the rule is in the document').to.include('Shift');
    // A count of the sheets carrying kbd's rule, not a delta: it reads the same whatever earlier rows adopted.
    expect(kbdSheets(), "document sheets carrying kbd's words rule").to.equal(1);
    a.remove();
    b.remove();
  });

  it("another component's key part of the same name gets no word (the rule asks for kbd's own mark)", async () => {
    const ours = make();
    document.body.append(ours);
    flush();
    await frame();
    const foreign = document.createElement('kbd');
    foreign.setAttribute('data-vera-part', 'key');
    foreign.setAttribute('data-vera-word', 'Shift');
    document.body.append(foreign);
    expect(spoken(ours), 'positive control: the rule is in the document').to.include('Shift');
    expect(getComputedStyle(foreign, '::before').content).to.be.oneOf(['none', 'normal']);
    ours.remove();
    foreign.remove();
  });

  it('under a tag of the caller\'s own (defineAs): the word rule applies, found by its mark, never by the tag', async () => {
    const kbd = document.createElement('my-kbd');
    kbd.setAttribute('keys', 'Mod+Shift+K');
    kbd.setAttribute('platform', 'apple');
    document.body.append(kbd);
    flush();
    await frame();
    expect(kbd.querySelector('[data-vera-word]'), 'CONTROL: rendered its symbol keys').to.not.equal(null);
    expect(spoken(kbd)).to.include('Shift');
    kbd.remove();
  });

  it("in someone's shadow root: adopted there (the document's sheet stops at the boundary)", async () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const kbd = make();
    root.append(kbd);
    document.body.append(host);
    flush();
    await frame();
    expect(spoken(kbd)).to.include('Shift');
    expect(root.adoptedStyleSheets.length).to.equal(1);
    host.remove();
  });

  it('a shadow root moved into another document gets a sheet of that document at the next connect', async () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const kbd = make();
    root.append(kbd);
    document.body.append(host);
    flush();
    await frame();
    expect(spoken(kbd), 'CONTROL: spoken at home').to.include('Shift');
    const f = await iframeReady();
    f.contentDocument.body.append(host);
    await frame(f.contentWindow);
    flush();
    await frame(f.contentWindow);
    expect(spoken(kbd), 'spoken in the other document').to.include('Shift');
    f.remove();
  });

  it('a page that replaced the document\'s adoptedStyleSheets gets the rule back at the next connect', async () => {
    const kbd = make();
    document.body.append(kbd);
    flush();
    await frame();
    document.adoptedStyleSheets = [];
    kbd.remove();
    document.body.append(kbd);
    flush();
    await frame();
    expect(spoken(kbd)).to.include('Shift');
    kbd.remove();
  });

  it('a selection of the shortcut holds exactly what is shown: ⇧⌘K on Apple, Ctrl+Shift+K elsewhere', async () => {
    const kbd = make();
    document.body.append(kbd);
    flush();
    await frame();
    const select = () => {
      const range = document.createRange();
      range.selectNodeContents(kbd);
      const selection = getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    };
    expect(select()).to.equal('⇧⌘K');
    kbd.setAttribute('platform', 'other');
    flush();
    await frame();
    expect(select()).to.equal('Ctrl+Shift+K');
    getSelection().removeAllRanges();
    kbd.remove();
  });
});

describe('vera-kbd: the look', () => {
  /** A combo mounted in `parent` markup (`<p style=…>`), rendered; returns the parent. */
  const mounted = async (open, keys = 'Mod+Shift+K', attrs = '') => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `${open}<vera-kbd keys="${keys}" platform="other" ${attrs}></vera-kbd></p>`;
    document.body.append(wrap);
    flush();
    await frame();
    return wrap;
  };
  const firstKey = (wrap) => wrap.querySelector('[data-vera-part="key"]');

  it('a key is a keycap: a solid border, heavier below, and the combo takes the page\'s font, not monospace', async () => {
    const wrap = await mounted('<p style="font-family: Georgia, serif">');
    const key = getComputedStyle(firstKey(wrap));
    expect(parseFloat(key.borderTopWidth), 'the key has a border').to.be.above(0);
    expect(parseFloat(key.borderBottomWidth)).to.be.above(parseFloat(key.borderTopWidth));
    expect(key.borderTopStyle).to.equal('solid');
    const combo = wrap.querySelector('[data-vera-part="combo"]');
    expect(getComputedStyle(combo).fontFamily).to.equal(getComputedStyle(wrap.querySelector('p')).fontFamily);
    expect(key.fontFamily).to.equal(getComputedStyle(wrap.querySelector('p')).fontFamily);
    wrap.remove();
  });

  it('every length is in em: a key under a 20px parent is 1.25 times the one under a 16px parent', async () => {
    const small = await mounted('<p style="font-size: 16px">');
    const large = await mounted('<p style="font-size: 20px">');
    const ratio = firstKey(large).getBoundingClientRect().height / firstKey(small).getBoundingClientRect().height;
    expect(firstKey(small).getBoundingClientRect().height, 'CONTROL: a box was measured').to.be.above(0);
    expect(ratio).to.be.within(1.2, 1.3);
    small.remove();
    large.remove();
  });

  it('a key in running text never pushes its line apart (an inline box: padding and border take no part in the line)', async () => {
    const style = 'font-size: 16px; line-height: normal; width: 40em';
    const text = await mounted(`<p style="${style}">Press Ctrl+Shift+K now</p><p style="${style}">Press `);
    const plain = text.querySelector('p');
    const holding = text.querySelectorAll('p')[1];
    /** CONTROL: the same keycap as an inline-block grows the line, so the instrument can see the trap. */
    const naive = document.createElement('p');
    naive.setAttribute('style', style);
    naive.innerHTML = 'Press <span style="display:inline-block;padding:.05em .4em;font-size:.85em;border:.0625em solid;border-bottom-width:.125em">K</span> now';
    text.append(naive);
    expect(naive.getBoundingClientRect().height, 'CONTROL: an inline-block keycap grows the line').to.be.above(plain.getBoundingClientRect().height);
    expect(holding.getBoundingClientRect().height).to.equal(plain.getBoundingClientRect().height);
    text.remove();
  });

  it('a shortcut never breaks inside: at a line end the combo moves whole, so no keycap is sliced across lines', async () => {
    /** "Page Up" holds a space, a break opportunity; the combo alone is wider than the 4em paragraph it sits in. */
    const style = 'font-size: 16px; width: 4em';
    const ours = await mounted(`<p style="${style}">`, 'Ctrl+PageUp');
    const control = await mounted(`<p style="${style}">`, 'Ctrl+PageUp');
    /** CONTROL: the same combo allowed to wrap breaks over two lines, so the narrow paragraph does put it at a line end. */
    control.querySelector('[data-vera-part="combo"]').style.whiteSpace = 'normal';
    expect(control.querySelector('[data-vera-part="combo"]').getClientRects().length, 'CONTROL: a wrapping combo splits').to.be.above(1);
    expect(ours.querySelector('[data-vera-part="combo"]').getClientRects().length).to.equal(1);
    ours.remove();
    control.remove();
  });

  it('data-vera-look="none" on the host drops the look; the words rule stays', async () => {
    const off = await mounted('<p>', 'Mod+Shift+K', 'data-vera-look="none"');
    const on = await mounted('<p>');
    expect(parseFloat(getComputedStyle(firstKey(on)).borderTopWidth), 'CONTROL: the same key without the opt-out is styled').to.be.above(0);
    expect(parseFloat(getComputedStyle(firstKey(off)).borderTopWidth)).to.equal(0);
    const apple = await mounted('<p>', 'Shift+K', 'data-vera-look="none"');
    apple.querySelector('vera-kbd').setAttribute('platform', 'apple');
    flush();
    await frame();
    expect(spoken(apple.querySelector('vera-kbd'))).to.include('Shift');
    for (const wrap of [off, on, apple]) wrap.remove();
  });

  it('forced colors: the key keeps a visible border, in the system text color', async () => {
    const wrap = await mounted('<p>');
    /** Where the engine has a forced-colors mode, emulated and read; WebKit has none, so there the parsed rule is read. */
    if (ENGINE?.name !== 'WebKit') {
      await emulateMedia({ forcedColors: 'active' });
      try {
        expect(matchMedia('(forced-colors: active)').matches, `CONTROL on ${ON}: forced colors are emulated`).to.equal(true);
        const probe = document.createElement('span');
        probe.style.color = 'CanvasText';
        document.body.append(probe);
        const key = getComputedStyle(firstKey(wrap));
        expect(parseFloat(key.borderTopWidth)).to.be.above(0);
        expect(key.borderTopStyle).to.equal('solid');
        expect(key.borderTopColor).to.equal(getComputedStyle(probe).color);
        probe.remove();
      } finally {
        await emulateMedia({ forcedColors: 'none' });
      }
    }
    const sheet = document.adoptedStyleSheets.find((s) => [...s.cssRules].some((r) => (r.selectorText ?? '').includes('data-vera-kbd')));
    expect(sheet, 'CONTROL: kbd\'s sheet is adopted').to.not.equal(undefined);
    const text = [...sheet.cssRules].map((r) => r.cssText).join('\n');
    expect(text).to.not.include('forced-color-adjust');
    const key = [...sheet.cssRules].find((r) => (r.selectorText ?? '').includes('"key"') && r.style.getPropertyValue('border-top-style'));
    expect(key.style.getPropertyValue('border-top-style')).to.equal('solid');
    wrap.remove();
  });
});

describe('vera-kbd: in right-to-left text', () => {
  const lefts = (kbd) => [...kbd.querySelectorAll('[data-vera-part="key"]')].map((key) => key.getBoundingClientRect().left);

  /** With the look and without it: the order comes from the combo's own dir attribute, never from kbd's sheet. */
  for (const look of ['', ' data-vera-look="none"'])
  it(`a combo keeps its left-to-right order inside a right-to-left sentence, and the sentence keeps its own${look ? ' (no look)' : ''}`, async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = `<p dir="rtl" style="font-size: 16px"><span id="before">לחץ</span> <vera-kbd keys="Mod+Shift+K" platform="apple"${look}></vera-kbd> <span id="after">עכשיו</span></p>`;
    document.body.append(wrap);
    flush();
    await frame();
    const kbd = wrap.querySelector('vera-kbd');
    expect(kbd.textContent, 'CONTROL: Apple\'s spelling rendered').to.equal('⇧⌘K');
    const [shift, command, k] = lefts(kbd);
    expect(shift, '⇧ left of ⌘').to.be.below(command);
    expect(command, '⌘ left of K').to.be.below(k);
    /** POSITIVE CONTROL: the sentence still flows right to left (the isolate flipped nothing around it). */
    const before = wrap.querySelector('#before').getBoundingClientRect();
    const after = wrap.querySelector('#after').getBoundingClientRect();
    const combo = kbd.querySelector('[data-vera-part="combo"]').getBoundingClientRect();
    expect(before.left, 'the first word is rightmost').to.be.above(combo.right);
    expect(after.right, 'the last word is leftmost').to.be.below(combo.left);
    wrap.remove();
  });
});
