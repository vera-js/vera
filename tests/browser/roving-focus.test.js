/**
 * **`rovingFocus` under real keys**: what an engine does with the tab stops the hook writes (Tab enters a group once and
 * leaves it in one more stop, both ways), the key table in left to right and right to left, a modified key left to the
 * platform, a group in an iframe (its own realm), and axe over a wired toolbar. The jsdom suite
 * (`tests/hook-roving-focus.test.mjs`) holds the decisions; only a real engine says what Tab does with them.
 *
 * Correctness only, headless: never time with this suite. No row presses Alt+arrow: in Chromium that is history
 * navigation, which would take the test page away; Ctrl+arrow is the modified-key row.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys } from '@web/test-runner-commands';
import { rovingFocus } from '../../packages/hooks/roving-focus/dist/development/vera-roving-focus.js';

await new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/node_modules/axe-core/axe.min.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});

let fixture;
const mount = (markup) => {
  fixture = document.createElement('div');
  fixture.innerHTML = markup;
  document.body.append(fixture);
  return fixture;
};
afterEach(() => fixture?.remove());

const TOOLBAR = '<button id="before">before</button><div role="toolbar" aria-label="Tools" id="g"><button>a</button><button>b</button><button>c</button></div><button id="after">after</button>';

/** The id or text of the focused element, for a readable failure. */
const focused = () => document.activeElement?.id || document.activeElement?.textContent;

describe('rovingFocus in a real engine', () => {
  it('Tab enters the group once and leaves it in one more stop, forward and backward, after an item was added', async () => {
    mount(TOOLBAR);
    const group = fixture.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    group.append(Object.assign(document.createElement('button'), { textContent: 'late' }));
    fixture.querySelector('#before').focus();
    await sendKeys({ press: 'Tab' });
    expect(focused()).to.equal('a');
    await sendKeys({ press: 'Tab' });
    expect(focused()).to.equal('after', 'one stop in the group going forward (the late item is not a stop)');
    await sendKeys({ press: 'Shift+Tab' });
    expect(focused()).to.equal('a');
    await sendKeys({ press: 'Shift+Tab' });
    expect(focused()).to.equal('before', 'one stop going backward');
  });

  it('CONTROL: without the hook the same toolbar has three stops', async () => {
    mount(TOOLBAR);
    fixture.querySelector('#before').focus();
    await sendKeys({ press: 'Tab' });
    await sendKeys({ press: 'Tab' });
    expect(focused()).to.equal('b');
  });

  it('the key table, left to right: Right, Left, End, Home, and the wrap', async () => {
    mount(TOOLBAR);
    const group = fixture.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    group.children[0].focus();
    const seen = [];
    for (const press of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowLeft', 'End', 'Home']) {
      await sendKeys({ press });
      seen.push(focused());
    }
    expect(seen).to.deep.equal(['b', 'c', 'a', 'c', 'c', 'a']);
  });

  it('the key table, right to left: Left moves forward and Right back', async () => {
    mount(`<div dir="rtl">${TOOLBAR}</div>`);
    const group = fixture.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    group.children[0].focus();
    await sendKeys({ press: 'ArrowLeft' });
    expect(focused()).to.equal('b');
    await sendKeys({ press: 'ArrowRight' });
    expect(focused()).to.equal('a');
  });

  it('Ctrl+arrow is left to the platform: not taken, focus stays; the plain arrow is the control', async () => {
    mount(TOOLBAR);
    const group = fixture.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    let taken = null;
    const spy = (event) => (taken = event.defaultPrevented);
    document.addEventListener('keydown', spy);
    try {
      group.children[0].focus();
      await sendKeys({ press: 'Control+ArrowRight' });
      expect(taken).to.equal(false);
      expect(focused()).to.equal('a');
      await sendKeys({ press: 'ArrowRight' });
      expect(taken).to.equal(true, 'CONTROL');
    } finally {
      document.removeEventListener('keydown', spy);
    }
  });

  it('a group in an iframe works in its own realm', async () => {
    mount('<iframe></iframe>');
    const frame = fixture.querySelector('iframe');
    const doc = frame.contentDocument;
    doc.body.innerHTML = '<div id="g"><button>a</button><button>b</button></div>';
    const group = doc.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    group.children[0].focus();
    await sendKeys({ press: 'ArrowRight' });
    expect(doc.activeElement === group.children[1]).to.equal(true);
  });

  it('axe finds nothing on a wired toolbar', async () => {
    mount(TOOLBAR);
    const group = fixture.querySelector('#g');
    rovingFocus(group, { items: () => [...group.children], orientation: 'horizontal' });
    const { violations } = await globalThis.axe.run(fixture, { resultTypes: ['violations'] });
    expect(violations.map((v) => v.id)).to.deep.equal([]);
  });
});
