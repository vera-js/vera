/**
 * **<vera-kbd> in the three engines, with `@verajs/styles` NOT wired**: the rule that speaks a symbol's word is adopted
 * by the element itself into whichever root it renders in (the document, someone's shadow root, a shadow root moved
 * into another document), and what a selection of ⇧⌘K holds is exactly what is shown. Correctness only, headless.
 * The rule's effect is read as the computed `content` of a symbol key's `::before`, which carries the word as alt text.
 */
import { expect } from '@esm-bundle/chai';
import { flush, wire } from '../../packages/core/dist/development/vera.js';
import { renderer } from '../../packages/renderer/dist/development/vera-renderer.js';
import '../../packages/components/kbd/dist/development/vera-kbd.js';
import { defineAs } from '../../packages/components/kbd/dist/development/vera-kbd-element.js';

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
    const before = document.adoptedStyleSheets.length;
    const a = make();
    const b = make();
    document.body.append(a, b);
    flush();
    await frame();
    expect(spoken(a)).to.include('Shift');
    expect(document.adoptedStyleSheets.length - before).to.equal(1);
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
