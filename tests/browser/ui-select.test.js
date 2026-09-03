/**
 * `<vera-select>` where only a real engine can testify: `::part()` rules actually painting
 * through the shadow boundary, tokens theming through it, the light-mode stylesheet hoisted with
 * `@scope` staying scoped to the tag, page CSS styling slotted content, and form association
 * producing real FormData. jsdom holds the logic; these hold the platform.
 *
 * Everything imports by bare specifier so the test and the bundles share one core — the same
 * one-registry rule a CDN page lives by.
 */
import { expect } from '@esm-bundle/chai';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@verajs/ui';

wire([renderer, styles]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

const OPTIONS = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

const mount = async (setup = () => {}) => {
  const element = document.createElement('vera-select');
  setup(element);
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();
  return element;
};

const withStyle = async (css, run) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  try {
    await frame();
    return await run();
  } finally {
    style.remove();
  }
};

it('the default select paints: the trigger takes the stylesheet inside the shadow root', async () => {
  const element = await mount();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('6px'); // --vera-radius fallback
  element.remove();
});

it('::part() from the page beats the component’s own rule — the shadow override door works', async () => {
  const element = await mount();
  await withStyle('vera-select::part(trigger) { border-radius: 0px; padding-left: 40px; }', async () => {
    const trigger = element.shadowRoot.querySelector('[part="trigger"]');
    expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('0px');
    expect(getComputedStyle(trigger).paddingLeft).to.equal('40px');
  });
  element.remove();
});

it('a --vera token themes through the boundary without touching a selector', async () => {
  const element = await mount();
  await withStyle('vera-select { --vera-radius: 11px; }', async () => {
    const trigger = element.shadowRoot.querySelector('[part="trigger"]');
    expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('11px');
  });
  element.remove();
});

it('the menu fades and slides rather than jumping, and the arrow flips — polled, never sampled', async () => {
  const element = await mount();
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const closedArrow = getComputedStyle(trigger, '::after').transform;

  expect(getComputedStyle(menu).visibility).to.equal('hidden', 'closed means untabbable and unread');
  trigger.click();
  /**
   * Polled, per the animation-recipes lesson: a fixed-instant sample lies on a loaded machine.
   * Any opacity strictly between the endpoints proves it fades rather than jumps.
   */
  let mid = null;
  for (let i = 0; i < 120 && mid === null; i++) {
    const value = Number(getComputedStyle(menu).opacity);
    if (value > 0 && value < 1) mid = value;
    else await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(mid, 'opacity never took a value between 0 and 1 — it jumped').to.be.a('number');

  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(Number(getComputedStyle(menu).opacity)).to.equal(1);
  expect(getComputedStyle(menu).visibility).to.equal('visible');
  expect(getComputedStyle(trigger, '::after').transform).to.not.equal(closedArrow, 'the arrow flipped');
  element.remove();
});

it('an extreme radius token makes a pill trigger, never a lens menu — the cap holds', async () => {
  const element = await mount();
  await withStyle('vera-select { --vera-radius: 999px; }', async () => {
    const trigger = element.shadowRoot.querySelector('[part="trigger"]');
    const menu = element.shadowRoot.querySelector('[part="menu"]');
    expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('999px', 'the trigger honors the pill');
    expect(getComputedStyle(menu).borderTopLeftRadius).to.equal('14px', 'the menu caps what it borrows');
  });
  element.remove();
});

it('light mode hoists a scoped sheet: styled inside the tag, inert outside it', async () => {
  const element = await mount((el) => el.setAttribute('light', ''));
  const trigger = element.querySelector('[part="trigger"]');
  expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('6px', 'styled with no shadow root');

  /** The same part attribute outside the component must take nothing from our sheet. */
  const stray = document.createElement('div');
  stray.setAttribute('part', 'trigger');
  document.body.appendChild(stray);
  await frame();
  expect(getComputedStyle(stray).cursor).to.not.equal('pointer', '@scope keeps the rules inside the tag');
  stray.remove();

  /** And a plain page rule beats the hoisted sheet — :where() holds ours at zero specificity. */
  await withStyle('.mine { padding-left: 33px; }', async () => {
    trigger.classList.add('mine');
    await frame();
    expect(getComputedStyle(trigger).paddingLeft).to.equal('33px');
  });
  element.remove();
});

it('slotted markup is the page’s: page CSS and page classes style it, and it drives the menu', async () => {
  const element = document.createElement('vera-select');
  const trigger = document.createElement('button');
  trigger.slot = 'trigger';
  trigger.className = 'custom-trigger';
  trigger.textContent = 'Custom';
  element.appendChild(trigger);
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();

  await withStyle('.custom-trigger { letter-spacing: 3px; }', async () => {
    expect(getComputedStyle(trigger).letterSpacing).to.equal('3px', 'page CSS reaches slotted content');
  });
  trigger.click();
  await frame();
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('open');
  expect(trigger.getAttribute('aria-expanded')).to.equal('true');
  element.remove();
});

it('the selected checkmark is one ::part pseudo rule away from replaced or gone', async () => {
  const element = await mount();
  element.value = 'a';
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  const selected = element.shadowRoot.querySelector('[part="option"][aria-selected="true"]');
  const unselected = element.shadowRoot.querySelector('[part="option"][aria-selected="false"]');
  expect(getComputedStyle(selected, '::before').content).to.equal('"✓"', 'the default mark');
  /**
   * The mark exists on every row (content cannot transition) and selection grows it from zero.
   * The selected endpoint is POLLED — the 140ms grow may be in flight at read time, and sampling
   * a transitioning value at an instant is the exact lie the animation-recipes lesson pins.
   */
  expect(getComputedStyle(unselected, '::before').scale).to.equal('0');
  expect(getComputedStyle(unselected, '::before').width).to.equal('0px', 'collapsed rows sit flush');
  const settled = () =>
    getComputedStyle(selected, '::before').scale === '1' &&
    parseFloat(getComputedStyle(selected, '::before').width) > 13.9;
  for (let i = 0; i < 120 && !settled(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  expect(getComputedStyle(selected, '::before').scale).to.equal('1', 'the mark grew to full size');
  /** WebKit reports the settled width with subpixel quantization (13.984…), so approximately. */
  expect(parseFloat(getComputedStyle(selected, '::before').width)).to.be.greaterThan(13.9);

  await withStyle('vera-select::part(option)::before { content: "→"; }', async () => {
    expect(getComputedStyle(selected, '::before').content).to.equal('"→"', 'replaced from the page');
  });
  await withStyle('vera-select::part(option)::before { content: none; }', async () => {
    expect(getComputedStyle(selected, '::before').content).to.equal('none', 'or removed entirely');
  });
  element.remove();
});

it('a page <label for> names the trigger through ElementInternals — no boundary crossing needed', async () => {
  const form = document.createElement('form');
  const label = document.createElement('label');
  label.htmlFor = 'flavor-select';
  label.textContent = 'Favorite flavor';
  const element = document.createElement('vera-select');
  element.id = 'flavor-select';
  form.append(label, element);
  document.body.appendChild(form);
  element.options = OPTIONS;
  await frame();
  expect(element.shadowRoot.querySelector('[part="trigger"]').getAttribute('aria-label')).to.equal('Favorite flavor');
  form.remove();
});

it('required means valueMissing until a pick, and the form refuses to validate an empty one', async () => {
  const form = document.createElement('form');
  const element = document.createElement('vera-select');
  element.setAttribute('name', 'flavor');
  element.setAttribute('required', '');
  form.appendChild(element);
  document.body.appendChild(form);
  element.options = OPTIONS;
  await frame();

  expect(form.checkValidity()).to.equal(false, 'empty + required is invalid');
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  element.shadowRoot.querySelectorAll('[part="option"]')[0].click();
  await frame();
  expect(form.checkValidity()).to.equal(true, 'a pick satisfies the constraint');
  form.remove();
});

it('the anchor tier: the menu rides the top layer and escapes an overflow:hidden ancestor', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && 'showPopover' in HTMLElement.prototype)) {
    /** Below the tier this engine keeps the in-host menu — covered by every other test here. */
    this.skip();
    return;
  }
  const clip = document.createElement('div');
  clip.style.cssText = 'overflow: hidden; height: 60px; width: 260px; position: relative;';
  const element = document.createElement('vera-select');
  clip.appendChild(element);
  document.body.appendChild(clip);
  element.options = OPTIONS;
  await frame();

  const menu = element.shadowRoot.querySelector('[part="menu"]');
  expect(menu.getAttribute('popover')).to.equal('manual', 'the tier applied the popover attribute');

  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  expect(menu.matches(':popover-open')).to.equal(true, 'the menu is in the top layer');
  const menuBox = menu.getBoundingClientRect();
  const clipBox = clip.getBoundingClientRect();
  expect(menuBox.bottom).to.be.greaterThan(clipBox.bottom + 20,
    'the dropdown escapes the overflow prison — the bug class every JS library portals around');
  expect(Math.abs(menuBox.width - element.shadowRoot.querySelector('[part="trigger"]').getBoundingClientRect().width))
    .to.be.lessThan(2, 'anchor-size(width) matches the trigger');

  element.close();
  /** The close transition plays while still popover-open; the popover hides after it settles. */
  for (let i = 0; i < 120 && menu.matches(':popover-open'); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(menu.matches(':popover-open')).to.equal(false, 'hidden after the transition settled');
  clip.remove();
});

it('below the tier or beside a slotted trigger, the fallback menu still works inside the host', async () => {
  const element = document.createElement('vera-select');
  const trigger = document.createElement('button');
  trigger.slot = 'trigger';
  trigger.textContent = 'Mine';
  element.appendChild(trigger); // a slotted trigger opts out of the tier (cross-root anchor question)
  document.body.appendChild(element);
  element.options = OPTIONS;
  await frame();
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  expect(menu.hasAttribute('popover')).to.equal(false);
  trigger.click();
  await frame();
  expect(menu.getAttribute('data-state')).to.equal('open', 'the everywhere-fallback path is intact');
  element.remove();
});

it('custom states are real: :state(open) and :state(empty) match and flip', async () => {
  const element = await mount();
  expect(element.matches(':state(empty)')).to.equal(true, 'nothing selected yet');
  expect(element.matches(':state(open)')).to.equal(false);

  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  expect(element.matches(':state(open)')).to.equal(true);

  element.shadowRoot.querySelectorAll('[part="option"]')[0].click();
  await frame();
  expect(element.matches(':state(empty)')).to.equal(false, 'a pick fills it');
  expect(element.matches(':state(open)')).to.equal(false, 'single mode closed');

  await withStyle('vera-select:state(open) { outline: 4px solid rgb(1, 2, 3); }', async () => {
    element.shadowRoot.querySelector('[part="trigger"]').click();
    await frame();
    expect(getComputedStyle(element).outlineColor).to.equal('rgb(1, 2, 3)', 'pages style the host by state');
  });
  element.remove();
});

it('multi pills: real remove buttons inside a div trigger, and the div takes focus', async () => {
  const element = await mount((el) => el.setAttribute('multi', ''));
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  expect(trigger.localName).to.equal('div', 'interactive children are legal again');
  trigger.focus();
  expect(element.shadowRoot.activeElement).to.equal(trigger, 'tabindex makes the div focusable');

  trigger.click();
  await frame();
  element.shadowRoot.querySelectorAll('[part="option"]')[0].click();
  await frame();
  const pill = element.shadowRoot.querySelector('[part="pill"]');
  expect(pill.textContent).to.contain('Alpha');
  pill.querySelector('[part="pill-remove"]').click();
  await frame();
  expect(element.value).to.deep.equal([], 'the chip removed itself without toggling the menu');
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('open');
  element.remove();
});

it('HTML-authored options work end to end: parse, icon paints, real form.reset() restores defaults', async () => {
  const form = document.createElement('form');
  form.innerHTML = `
    <vera-select name="flavor">
      <optgroup label="Classics">
        <option value="vanilla" selected>Vanilla</option>
        <option value="chocolate">Chocolate</option>
      </optgroup>
      <vera-option value="pistachio"><svg slot="icon" width="10" height="10"></svg>Pistachio</vera-option>
    </vera-select>`;
  document.body.appendChild(form);
  const element = form.querySelector('vera-select');
  await frame();

  expect(element.options.map((o) => o.value)).to.deep.equal(['vanilla', 'chocolate', 'pistachio']);
  expect(new FormData(form).get('flavor')).to.equal('vanilla', 'selected seeded the submitted value');

  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  const icon = element.shadowRoot.querySelector('[part="option-icon"] svg');
  expect(icon, 'the authored svg reached the shadow row').to.exist;
  expect(icon.getBoundingClientRect().width).to.be.greaterThan(0, 'and paints');

  element.shadowRoot.querySelectorAll('[part="option"]')[1].click();
  await frame();
  expect(new FormData(form).get('flavor')).to.equal('chocolate');
  form.reset();
  await frame();
  expect(new FormData(form).get('flavor')).to.equal('vanilla', 'reset restores the selected default, not emptiness');
  form.remove();
});

it('AUDIT P3 — form reflection follows a rename and a required toggle; unnamed multi submits nothing', async () => {
  const form = document.createElement('form');
  const element = document.createElement('vera-select');
  element.setAttribute('multi', '');
  element.setAttribute('name', 'old');
  form.appendChild(element);
  document.body.appendChild(form);
  element.options = OPTIONS;
  await frame();
  element.value = ['a', 'b'];
  element.setAttribute('name', 'renamed');
  await frame();
  expect([...new FormData(form).entries()].map((e) => e.join('='))).to.deep.equal(
    ['renamed=a', 'renamed=b'],
    'the FormData snapshot follows the rename'
  );

  element.removeAttribute('name');
  await frame();
  expect([...new FormData(form).entries()]).to.have.length(0, 'an unnamed control submits nothing, like native');

  /** required toggled after mount re-reflects validity, and the message speaks the consumer's words. */
  element.value = [];
  element.setAttribute('required-message', 'Scoop something');
  element.setAttribute('required', '');
  await frame();
  expect(element.checkValidity()).to.equal(false);
  expect(element.validationMessage).to.equal('Scoop something');
  element.removeAttribute('required');
  await frame();
  expect(element.checkValidity()).to.equal(true, 'untoggling required re-reflects without a value change');
  form.remove();
});

it('form association is real: the select submits like a control and resets with the form', async () => {
  const form = document.createElement('form');
  const element = document.createElement('vera-select');
  element.setAttribute('name', 'flavor');
  form.appendChild(element);
  document.body.appendChild(form);
  element.options = OPTIONS;
  await frame();

  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  element.shadowRoot.querySelectorAll('[part="option"]')[1].click();
  await frame();
  expect(new FormData(form).get('flavor')).to.equal('b');

  form.reset();
  await frame();
  expect(new FormData(form).get('flavor')).to.equal(null);
  expect(element.value).to.equal('', 'single-mode empty is the empty string');
  form.remove();
});
