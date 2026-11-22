/**
 * **<vera-tabs> in real engines**: the keys a user presses, how inactive panels are hidden where find-in-page can
 * reach them, a `beforematch` choosing its tab, and the indicator landing under the selected tab. jsdom has none of
 * hidden="until-found", anchor positioning or real focus, so these are the engines' rows.
 */
import { expect } from '@esm-bundle/chai';
import { sendKeys } from '@web/test-runner-commands';
import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { styles } from '@verajs/styles';
import '@vera-components/tabs';
import { until } from './until.js';
import { ON } from './engine.js';

wire([renderer, styles]);

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
const MARKUP =
  '<div slot="tabs"><button type="button" value="a">Alpha</button><button type="button" value="b">Beta</button><button type="button" value="c">Gamma</button></div>' +
  '<section data-value="a"><span>Panel A</span></section><section data-value="b"><span>Panel B</span></section><section data-value="c"><span>Panel C findme</span></section>';
const UNTIL_FOUND = 'onbeforematch' in HTMLElement.prototype && CSS.supports('content-visibility', 'hidden');

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});
const mount = async (attributes = '') => {
  const holder = document.createElement('div');
  holder.innerHTML = `<vera-tabs ${attributes}>${MARKUP}</vera-tabs>`;
  document.body.append(holder);
  made.push(holder);
  await frame();
  return holder.firstElementChild;
};
const tabs = (el) => [...el.querySelectorAll('[role="tab"]')];
const selected = (el) => tabs(el).find((tab) => tab.getAttribute('aria-selected') === 'true')?.value;

it('real keys: Tab reaches the selected tab, the arrows and End select, and Tab moves on into the panel', async () => {
  const el = await mount();
  const before = document.createElement('button');
  before.textContent = 'before';
  el.parentElement.prepend(before);
  before.focus();
  await sendKeys({ press: 'Tab' });
  expect(document.activeElement === tabs(el)[0], `${ON}: Tab lands on the selected tab`).to.equal(true);
  await sendKeys({ press: 'ArrowRight' });
  await until(() => selected(el) === 'b', 'ArrowRight selected B', 2000);
  await sendKeys({ press: 'End' });
  await until(() => selected(el) === 'c', 'End selected the last', 2000);
  await sendKeys({ press: 'Tab' });
  expect(document.activeElement === el.querySelector('[data-value="c"]'), `${ON}: Tab moves into the panel, which takes focus`).to.equal(true);
});

it('inactive panels are hidden="until-found" where the engine has it, plain hidden elsewhere and with findable="false"', async () => {
  const el = await mount();
  const panel = el.querySelector('[data-value="c"]');
  expect(panel.getAttribute('hidden'), `${ON}: an inactive panel`).to.equal(UNTIL_FOUND ? 'until-found' : '');
  /** An until-found panel keeps its box and hides its contents, so the contents are what a reader cannot see. */
  expect(el.querySelector('[data-value="a"] span').checkVisibility(), 'CONTROL: the shown panel\'s text is visible').to.equal(true);
  expect(panel.querySelector('span').checkVisibility(), `${ON}: the inactive panel's text is not`).to.equal(false);
  expect(panel.hasAttribute('tabindex'), 'and the inactive panel is out of the Tab order').to.equal(false);
  const plain = await mount('findable="false"');
  expect(plain.querySelector('[data-value="c"]').getAttribute('hidden'), 'findable="false"').to.equal('');
});

it('a beforematch in a hidden panel chooses its tab, with reason "find" and not cancelable', async () => {
  const el = await mount();
  const heard = [];
  el.addEventListener('beforetabchange', (event) => heard.push(['before', event.detail.reason, event.cancelable]));
  el.addEventListener('tabchange', (event) => heard.push(['change', event.detail.value, event.detail.reason]));
  el.querySelector('[data-value="c"]').dispatchEvent(new Event('beforematch', { bubbles: true }));
  await frame();
  expect(heard).to.deep.equal([['before', 'find', false], ['change', 'c', 'find']]);
  expect(selected(el)).to.equal('c');
});

it('the indicator sits under the selected tab and follows the selection (CONTROL: the tablist draws one)', async function () {
  if (!CSS.supports('top: anchor(bottom)')) return this.skip();
  const el = await mount();
  const list = el.querySelector('[data-vera-part="tablist"]');
  const after = () => getComputedStyle(list, '::after');
  expect(after().content, 'CONTROL: the ::after is drawn').to.not.equal('none');
  const under = (tab) => Math.abs(parseFloat(after().left) - tab.offsetLeft) < 1;
  await until(() => under(tabs(el)[0]), 'under the first tab', 2000);
  tabs(el)[2].click();
  await until(() => under(tabs(el)[2]), 'under the third, once the slide ends', 2000);
});

it('a page reset hiding [hidden] with display: none blocks find-in-page, and development says so once (tabs-until-found-blocked; CONTROL: without the reset, nothing)', async function () {
  if (!UNTIL_FOUND) return this.skip();
  const realWarn = console.warn;
  const warned = [];
  console.warn = (...args) => warned.push(args.map(String).join(' '));
  try {
    await mount();
    expect(warned.filter((line) => line.includes('tabs-until-found-blocked')), 'CONTROL: no reset, nothing said').to.deep.equal([]);
    const reset = document.createElement('style');
    reset.textContent = '[hidden] { display: none !important; }';
    document.head.append(reset);
    made.push(reset);
    const el = await mount();
    tabs(el)[1].click();
    await frame();
    const lines = warned.filter((line) => line.includes('tabs-until-found-blocked'));
    expect(lines.length, `${ON}: said once though the selection changed`).to.equal(1);
  } finally {
    console.warn = realWarn;
  }
});
