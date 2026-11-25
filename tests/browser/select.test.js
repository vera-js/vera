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
import { sendKeys, setViewport } from '@web/test-runner-commands';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/select';
import { frames, until } from './until.js';

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
  expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('8px'); // the shared --vera-radius default
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

  /**
   * Polled to SETTLEMENT for the same reason the loop above is polled, which this assertion used
   * to ignore: it slept a fixed 250 ms into a 140 ms transition and demanded exactly `1`. That is
   * the fixed-instant sample the comment above warns against, just at the other end — and a loaded
   * CI runner does not honor it. Linux WebKit reported 0.998519 and failed the run while Chromium,
   * Firefox and macOS WebKit all passed, which is what a machine-dependent assertion looks like.
   */
  let opacity = 0;
  for (let i = 0; i < 200; i++) {
    opacity = Number(getComputedStyle(menu).opacity);
    if (opacity === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(opacity, 'the fade settled fully open').to.equal(1);
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
  expect(getComputedStyle(trigger).borderTopLeftRadius).to.equal('8px', 'styled with no shadow root');

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
  expect(menuBox.width - element.shadowRoot.querySelector('[part="trigger"]').getBoundingClientRect().width)
    .to.be.greaterThan(-2, 'min-inline-size: anchor-size(width): the list is at least as wide as the trigger');

  element.close();
  /** The close transition plays while still popover-open; the popover hides after it settles. */
  for (let i = 0; i < 120 && menu.matches(':popover-open'); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(menu.matches(':popover-open')).to.equal(false, 'hidden after the transition settled');
  clip.remove();
});

/**
 * **On a scrolled page the list opens below a trigger with room below, and again when reopened.** With the engine's
 * `flip-block` fallback choosing the side, it opened ABOVE in Chromium 159 and WebKit whenever the page was scrolled
 * (placed by `top: anchor(bottom)` and by `position-area` alike); near the top of a page it opened down, so it looked
 * random. The scroll is rendered before each open, as a user's is: scrolled and clicked in one task, the row read a
 * different layout than any user gets. CONTROL: a trigger near the viewport's bottom still opens above.
 */
it('on a scrolled page the list opens below a trigger with room below, reopened too; near the bottom it flips', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && CSS.supports('position-area: block-end') && 'showPopover' in HTMLElement.prototype)) {
    this.skip();
    return;
  }
  const spacer = document.body.appendChild(document.createElement('div'));
  spacer.style.blockSize = '3000px';
  const element = document.createElement('vera-select');
  document.body.appendChild(element);
  const tail = document.body.appendChild(document.createElement('div'));
  tail.style.blockSize = '3000px';
  element.options = OPTIONS;
  await frame();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  const place = (y) => window.scrollBy(0, trigger.getBoundingClientRect().top - y);
  const open = async () => {
    trigger.click();
    await until(() => menu.matches(':popover-open'), 'the menu to open', 2000);
    /** Settled: the open's slide has ended (no transition on the menu still running). */
    await frames(1);
    await until(() => menu.getAnimations().every((a) => a.playState !== 'running'), 'the menu to settle (its slide ended)', 2000);
  };
  const close = async () => {
    element.close();
    await until(() => !menu.matches(':popover-open'), 'the menu to close', 3000);
  };
  try {
    place(Math.round(innerHeight * 0.3));
    await frames(2);
    expect(window.scrollY).to.be.greaterThan(2000, 'CONTROL: the page is scrolled');
    await open();
    expect(menu.getBoundingClientRect().top).to.be.at.least(trigger.getBoundingClientRect().bottom - 1, 'opened below the trigger');
    await close();
    await open();
    expect(menu.getBoundingClientRect().top).to.be.at.least(trigger.getBoundingClientRect().bottom - 1, 'reopened below the trigger');
    await close();
    place(innerHeight - trigger.getBoundingClientRect().height - 24);
    await frames(2);
    await open();
    expect(menu.getBoundingClientRect().bottom).to.be.at.most(trigger.getBoundingClientRect().top + 1, 'CONTROL: near the bottom it flips above');
    await close();
  } finally {
    window.scrollTo(0, 0);
    for (const node of [spacer, element, tail]) node.remove();
  }
});

/**
 * **A closed list is not laid out.** The menu's own `display: flex` is an author rule and beat the UA's hiding of a
 * closed popover, so every closed select laid its list out (hidden by visibility only) and measured its options:
 * creating 200 closed selects took +11% over main, and with this rule about half the time (headed Chromium, paired).
 * CONTROL: the open list is displayed, with a box.
 */
it('a closed list is display: none (never laid out); the open one is displayed', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && CSS.supports('position-area: block-end') && 'showPopover' in HTMLElement.prototype)) {
    this.skip();
    return;
  }
  const element = await mount();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  try {
    expect(getComputedStyle(menu).display).to.equal('none', 'closed: not laid out');
    expect(menu.getBoundingClientRect().height).to.equal(0, 'closed: no box');
    trigger.click();
    await until(() => menu.matches(':popover-open'), 'the menu to open', 2000);
    expect(getComputedStyle(menu).display).to.not.equal('none', 'CONTROL: open, displayed');
    expect(menu.getBoundingClientRect().height).to.be.above(0, 'CONTROL: open, a box');
    element.close();
    await until(() => !menu.matches(':popover-open'), 'the menu to close', 3000);
    expect(getComputedStyle(menu).display).to.equal('none', 'closed again: not laid out');
  } finally {
    element.remove();
  }
});

/**
 * **An open list follows the page: scrolled until it would leave the screen below, it moves above, and back.** The side
 * is chosen at the open and again after each scroll or resize while open (once a frame). CONTROL: before the scroll the
 * open list is below its trigger.
 */
it('an open list moves above when a scroll leaves it no room below, and back below when room returns', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && CSS.supports('position-area: block-end') && 'showPopover' in HTMLElement.prototype)) {
    this.skip();
    return;
  }
  const spacer = document.body.appendChild(document.createElement('div'));
  spacer.style.blockSize = '3000px';
  const element = document.createElement('vera-select');
  document.body.appendChild(element);
  const tail = document.body.appendChild(document.createElement('div'));
  tail.style.blockSize = '3000px';
  element.options = OPTIONS;
  await frame();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  const place = (y) => window.scrollBy(0, trigger.getBoundingClientRect().top - y);
  /** Each side's read holds only for an open list with a box: a closed or collapsed one would read as "above". */
  const shown = () => menu.matches(':popover-open') && menu.getBoundingClientRect().height > 20;
  const below = () => shown() && menu.getBoundingClientRect().top >= trigger.getBoundingClientRect().bottom - 1;
  const above = () => shown() && menu.getBoundingClientRect().bottom <= trigger.getBoundingClientRect().top + 1;
  try {
    place(Math.round(innerHeight * 0.3));
    await frames(2);
    trigger.click();
    await until(() => menu.matches(':popover-open'), 'the menu to open', 2000);
    await until(() => below(), 'CONTROL: the open list below its trigger', 2000);
    place(innerHeight - trigger.getBoundingClientRect().height - 24);
    await until(() => above(), 'the open list to move above once no room is left below', 2000);
    place(Math.round(innerHeight * 0.3));
    await until(() => below(), 'the open list to come back below when room returns', 2000);
  } finally {
    element.close();
    window.scrollTo(0, 0);
    for (const node of [spacer, element, tail]) node.remove();
  }
});

/**
 * **Opening a select that has a value scrolls its list to that row, and only the list.** The row is revealed inside the
 * list by its rect, not by `scrollIntoView`, which scrolls every ancestor, the page included. The page holding still
 * was green on the scrollIntoView bytes too (Chromium, Firefox, WebKit): it guards the page, it did not catch a jump. The
 * list's own scroll is what this row can fail on (a reveal that does nothing leaves it at 0).
 */
it('opening a select with a value scrolls its list to the row, and the page holds still', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && CSS.supports('position-area: block-end') && 'showPopover' in HTMLElement.prototype)) {
    this.skip();
    return;
  }
  const many = Array.from({ length: 40 }, (_, i) => ({ label: `Flavor ${i}`, value: `f${i}` }));
  const spacer = document.body.appendChild(document.createElement('div'));
  spacer.style.blockSize = '3000px';
  const element = document.createElement('vera-select');
  document.body.appendChild(element);
  const tail = document.body.appendChild(document.createElement('div'));
  tail.style.blockSize = '3000px';
  element.options = many;
  element.value = 'f35';
  await frame();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const list = element.shadowRoot.querySelector('[part="list"]');
  try {
    window.scrollBy(0, trigger.getBoundingClientRect().top - Math.round(innerHeight * 0.3));
    await frames(2);
    const before = window.scrollY;
    expect(before).to.be.greaterThan(2000, 'CONTROL: the page is scrolled');
    trigger.click();
    await until(() => element.shadowRoot.querySelector('[part="menu"]').matches(':popover-open'), 'the menu to open', 2000);
    await frames(4);
    expect(window.scrollY).to.equal(before, 'the page did not move');
    expect(list.scrollTop).to.be.greaterThan(0, 'the list scrolled to the selected row, past its end');
  } finally {
    element.close();
    window.scrollTo(0, 0);
    for (const node of [spacer, element, tail]) node.remove();
  }
});

it('marked aria-invalid (a field showing an error), the trigger takes the danger color, in shadow and light mode', async () => {
  for (const light of [false, true]) {
    const element = document.createElement('vera-select');
    if (light) element.setAttribute('light', '');
    element.style.setProperty('--vera-danger', 'rgb(200, 0, 0)');
    element.style.setProperty('--vera-border-control', 'rgb(0, 0, 200)');
    document.body.appendChild(element);
    element.options = OPTIONS;
    await frame();
    const trigger = (element.shadowRoot ?? element).querySelector('[part="trigger"]');
    try {
      expect(getComputedStyle(trigger).borderTopColor).to.equal('rgb(0, 0, 200)', `CONTROL (${light ? 'light' : 'shadow'}): valid, the border token`);
      element.setAttribute('aria-invalid', 'true');
      await until(() => getComputedStyle(trigger).borderTopColor === 'rgb(200, 0, 0)', `the ${light ? 'light' : 'shadow'} trigger to take the danger color`, 2000);
    } finally {
      element.remove();
    }
  }
});

it('the list grows past a narrow trigger to fit a long option, up to its cap', async function () {
  if (!(CSS.supports('top: anchor(bottom)') && CSS.supports('position-area: block-end') && 'showPopover' in HTMLElement.prototype)) {
    this.skip();
    return;
  }
  const element = document.createElement('vera-select');
  element.style.inlineSize = '80px';
  document.body.appendChild(element);
  element.options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'A considerably longer option than its trigger is wide' }];
  await frame();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  const menu = element.shadowRoot.querySelector('[part="menu"]');
  try {
    trigger.click();
    await until(() => menu.matches(':popover-open'), 'the menu to open', 2000);
    const width = menu.getBoundingClientRect().width;
    expect(width).to.be.greaterThan(trigger.getBoundingClientRect().width + 40, 'the list grew past the trigger for its long option');
    expect(width).to.be.at.most(28 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 1, 'and stops at 28rem');
  } finally {
    element.close();
    element.remove();
  }
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

it('the placeholder actually PAINTS on an empty trigger — :empty is fragile and now guarded', async () => {
  const element = await mount((el) => el.setAttribute('placeholder', 'Pick something…'));
  const value = element.shadowRoot.querySelector('[part="value"]');
  /**
   * The placeholder rides ::before via :empty, and :empty dies to ANY static text node in the
   * template — even pure indentation (a multi-line value span erased every placeholder on the
   * demo page; engines do not ship whitespace-tolerant :empty). Computed content is the truth.
   */
  expect(value.matches(':empty')).to.equal(true, 'no stray text nodes may enter the value span');
  /** Firefox serializes the computed content as the unresolved `attr(data-placeholder)`;
   *  Chromium/WebKit resolve it. Both paint — the guard is that it is not `none`. */
  expect(getComputedStyle(value, '::before').content).to.not.equal('none', 'and it paints');

  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  element.shadowRoot.querySelectorAll('[part="option"]')[0].click();
  await frame();
  expect(getComputedStyle(value, '::before').content).to.equal('none', 'a selection displaces it');
  element.remove();
});

it('AUDIT — a real Tab from an open menu lands on the next control, never inside the list', async () => {
  const element = await mount();
  const after = document.createElement('button');
  after.textContent = 'next control';
  document.body.appendChild(after);
  /**
   * Chrome and Firefox make scroll containers keyboard-focusable when they carry no explicit
   * tabindex — pure UA magic, invisible to any tabIndex property read. Without the listbox's
   * explicit tabindex="-1", Tab walked INTO the scrollable list, the close then display:none'd
   * it a frame later, and focus fell to body: the user's Tab was eaten (Brian hit this on the
   * demo page). Only a real keypress can regress-test it, hence sendKeys.
   */
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  trigger.focus();
  await sendKeys({ press: ' ' });
  await frame();
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('open');
  await sendKeys({ press: 'Tab' });
  await frame();
  await frame();
  expect(document.activeElement).to.equal(after, 'Tab leaves the widget for the next control');
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('closed', 'and the menu closed behind it');
  after.remove();
  element.remove();
});

it('AUDIT — form and labels answer through internals with real form ownership', async () => {
  const form = document.createElement('form');
  const label = document.createElement('label');
  label.htmlFor = 'idl-x';
  label.textContent = 'Pick';
  document.body.appendChild(form);
  form.appendChild(label);
  const element = document.createElement('vera-select');
  element.id = 'idl-x';
  element.setAttribute('name', 'x');
  form.appendChild(element);
  element.options = OPTIONS;
  await frame();
  expect(element.form).to.equal(form, 'form identity through internals');
  expect(element.labels.length).to.equal(1, 'the associated label is listed');
  form.remove();
});

it('AUDIT — the search line takes focus on FIRST open, and typing reaches it', async () => {
  /**
   * The search auto-focus silently failed on first open: the menu's visibility transition left
   * it computed-hidden for a window after data-state flipped, and a real engine refuses focus()
   * into hidden content (jsdom focuses anything). Every keystroke then fed the trigger's
   * typeahead instead of the filter, which killed the creatable and remote flows for any user
   * who did not click the input by hand. The fix is the direction-split visibility transition +
   * the deferred focus; this pins the whole user path with real keys.
   */
  const element = await mount((el) => el.setAttribute('creatable', ''));
  element.shadowRoot.querySelector('[part="trigger"]').click();
  await frame();
  await frame();
  expect(element.shadowRoot.activeElement?.getAttribute('part')).to.equal('search', 'first open focuses the search line');
  await sendKeys({ type: 'Neb' });
  await frame();
  expect(element.shadowRoot.querySelector('[part="search"]').value).to.equal('Neb', 'keystrokes reach the filter');
  expect(element.shadowRoot.querySelector('[part="option"][data-create]')).to.not.equal(null, 'the create row appears');
  element.remove();
});

it('P4 — the menu is viewport-aware in SIZE: a short viewport squeezes it, never strands rows', async () => {
  if (!CSS.supports('position-area: block-end')) return;
  /**
   * Top-layer content does not scroll with the page, so a menu taller than the viewport strands
   * its overflow rows unreachable. The size cap (position-area + a 100% cap on the chosen
   * side; position-area makes 100% that side's room) shrinks the menu into the available area and
   * lets the list scroll.
   */
  await setViewport({ width: 700, height: 240 });
  try {
    const element = await mount((el) => {
      el.options = Array.from({ length: 30 }, (_, i) => ({ label: `Row ${i}`, value: `r${i}` }));
    });
    element.options = Array.from({ length: 30 }, (_, i) => ({ label: `Row ${i}`, value: `r${i}` }));
    await frame();
    element.shadowRoot.querySelector('[part="trigger"]').click();
    await frame();
    await frame();
    const menu = element.shadowRoot.querySelector('[part="menu"]').getBoundingClientRect();
    expect(menu.top).to.be.at.least(-1);
    expect(menu.bottom).to.be.at.most(window.innerHeight + 1, 'squeezed into the viewport, never clipped');
    const list = element.shadowRoot.querySelector('[part="list"]');
    expect(list.scrollHeight).to.be.greaterThan(list.clientHeight, 'and the rows stay reachable by scroll');
    element.remove();
  } finally {
    await setViewport({ width: 800, height: 600 });
  }
});

it('AUDIT — Escape dismisses through CloseWatcher: a real keypress closes and refocuses', async () => {
  if (typeof CloseWatcher === 'undefined') return;
  /**
   * On CloseWatcher engines the fallback keydown listener is not installed at all — the UA
   * stacks close requests and arbitrates innermost-first, like native <dialog>. CloseWatcher
   * ignores synthetic events, so ONLY a real key can prove this path; jsdom exercises the
   * fallback listener.
   */
  const element = await mount();
  const trigger = element.shadowRoot.querySelector('[part="trigger"]');
  trigger.focus();
  await sendKeys({ press: ' ' });
  await frame();
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('open');
  await sendKeys({ press: 'Escape' });
  await frame();
  await frame();
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('closed', 'the UA close request dismissed the menu');
  expect(element.shadowRoot.activeElement).to.equal(trigger, 'and focus returned to the trigger');
  /** The watcher dies with deactivation: a later Escape must not throw or act. */
  await sendKeys({ press: 'Escape' });
  await frame();
  expect(element.shadowRoot.querySelector('[part="menu"]').getAttribute('data-state')).to.equal('closed');
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

it('in the light DOM, each menu opens under its OWN trigger, not the last one on the page', async () => {
  if (!CSS.supports('top: anchor(bottom)')) return;
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:96px;padding:48px';
  const one = document.createElement('vera-select');
  const two = document.createElement('vera-select');
  for (const element of [one, two]) {
    element.setAttribute('light', '');
    element.style.width = '100px';
    row.appendChild(element);
  }
  document.body.appendChild(row);
  for (const element of [one, two]) element.options = OPTIONS;
  await frame();
  one.open();
  /** Read once the open fade has settled (the menu fully opaque), not at a time a loaded machine may not have reached. */
  const opened = one.querySelector('[part="menu"]');
  await until(() => opened.matches(':popover-open') && Number(getComputedStyle(opened).opacity) === 1, 'the first menu opened and settled', 5000);
  const trigger = one.querySelector('[part="trigger"]').getBoundingClientRect();
  const menu = one.querySelector('[part="menu"]').getBoundingClientRect();
  const other = two.querySelector('[part="trigger"]').getBoundingClientRect();
  expect(Math.abs(other.left - trigger.left), 'CONTROL: the two triggers are apart').to.be.greaterThan(100);
  expect(Math.round(menu.left), 'the first menu sits under the first trigger').to.equal(Math.round(trigger.left));
  one.close();
  row.remove();
});
