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
  expect(element.value).to.deep.equal([]);
  form.remove();
});
