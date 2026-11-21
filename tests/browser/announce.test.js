/**
 * **`announce` in a real engine**: what jsdom cannot hold. Modals (jsdom has no `:modal` and no inertness): an
 * announcement while a modal dialog is open is written inside it, and with two stacked, inside the focused one; the
 * region's computed style keeps it rendered for the accessibility tree. Whether a screen reader SPEAKS it is the
 * spoken sign-off, not this suite. Correctness only, headless: never time with this suite.
 */
import { expect } from '@esm-bundle/chai';
import { announce } from '../../packages/hooks/announce/dist/development/vera-announce.js';
import { until } from './until.js';

let fixture;
afterEach(() => {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  fixture?.remove();
  for (const region of document.querySelectorAll('[data-vera-announce]')) region.remove();
});

const mount = (markup) => {
  fixture = document.body.appendChild(document.createElement('div'));
  fixture.innerHTML = markup;
  return fixture;
};

/** The region holding `text`, once the write a task after the call has landed. */
const written = (text) =>
  until(() => [...document.querySelectorAll('[data-vera-announce]')].find((r) => r.textContent === text), `a region saying "${text}"`, 4000);

describe('announce in a real engine', () => {
  it('with no modal open, it speaks from body, and the region is rendered (not display: none) yet 1px and clipped', async () => {
    mount('<button id="b">b</button>');
    announce(fixture.querySelector('#b'), 'Saved');
    const region = await written('Saved');
    expect(region.parentNode === document.body).to.equal(true);
    const style = getComputedStyle(region);
    expect(style.display).to.not.equal('none');
    expect(style.visibility).to.equal('visible');
    expect(region.getBoundingClientRect().width <= 1).to.equal(true);
  });

  it('CONTROL: an open modal makes body inert, so a region on body would be silent', () => {
    mount('<dialog id="d"><button>in</button></dialog><button id="out">out</button>');
    fixture.querySelector('#d').showModal();
    fixture.querySelector('#out').focus();
    expect(document.activeElement?.id === 'out').to.equal(false);
  });

  it('while a modal dialog is open, it speaks from inside that dialog', async () => {
    mount('<dialog id="d"><button id="in">in</button></dialog>');
    const dialog = fixture.querySelector('#d');
    dialog.showModal();
    announce(fixture.querySelector('#in'), 'Saved in the dialog');
    const region = await written('Saved in the dialog');
    expect(region.parentNode === dialog).to.equal(true);
  });

  it('with two stacked modals, it speaks from the one holding focus', async () => {
    mount('<dialog id="b"><button id="in-b">b</button></dialog><dialog id="a"><button id="in-a">a</button></dialog>');
    const a = fixture.querySelector('#a');
    const b = fixture.querySelector('#b');
    a.showModal();
    b.showModal();
    expect(b.contains(document.activeElement)).to.equal(true, 'CONTROL: showModal moved focus into the top one');
    announce(fixture.querySelector('#in-a'), 'From the top');
    const region = await written('From the top');
    expect(region.parentNode === b).to.equal(true);
  });

  it('with focus fallen out of every modal, the last open one in the document serves', async () => {
    mount('<dialog id="a"><button id="in-a">a</button></dialog><dialog id="b"><button id="in-b">b</button></dialog>');
    const a = fixture.querySelector('#a');
    const b = fixture.querySelector('#b');
    a.showModal();
    b.showModal();
    document.activeElement?.blur();
    announce(fixture.querySelector('#in-a'), 'Fallback');
    const region = await written('Fallback');
    expect(region.parentNode === b).to.equal(true);
  });

  it('after the modal closes, it speaks from body again, still one region there', async () => {
    mount('<dialog id="d"><button id="in">in</button></dialog><button id="out">out</button>');
    const dialog = fixture.querySelector('#d');
    dialog.showModal();
    announce(fixture.querySelector('#in'), 'inside');
    await written('inside');
    dialog.close();
    announce(fixture.querySelector('#out'), 'outside');
    const region = await written('outside');
    expect(region.parentNode === document.body).to.equal(true);
    expect(document.body.querySelectorAll(':scope > [data-vera-announce="polite"]').length).to.equal(1);
  });
});
