/**
 * **The platform facts `<vera-tabs>`' indicator rests on**, asked of the engines before the component claims them: a
 * container's `::after`, absolutely positioned, anchors to a CHILD element's anchor name passed through a custom property
 * (`position-anchor: var(--x)`), and its anchored inset follows when the name moves to another child, with a CONTROL:
 * no anchor name anywhere leaves the pseudo-element where its fallback puts it. With a transition on that inset,
 * Chromium and WebKit pass through values in between (it slides); Firefox moves it straight to the new tab (measured
 * twice: the indicator jumps there, in the right place). The Firefox row pins the jump, so it turns red the day Firefox
 * interpolates an anchored inset, and the README's claim can widen.
 */
import { expect } from '@esm-bundle/chai';
import { until } from './until.js';
import { ENGINE, ON } from './engine.js';

const SUPPORTED = CSS.supports('top: anchor(bottom)');

let made = [];
afterEach(() => {
  for (const node of made) node.remove();
  made = [];
});

const build = (transition) => {
  const style = document.createElement('style');
  style.textContent =
    '.list{position:relative;display:flex;gap:40px;width:400px;--a:--tab-x}' +
    '.list>button{width:60px;height:30px}' +
    `.list::after{content:"";position:absolute;position-anchor:var(--a);left:anchor(left, 999px);width:10px;top:0;height:2px;background:red${transition ? ';transition:left 400ms linear' : ''}}`;
  const list = document.createElement('div');
  list.className = 'list';
  list.innerHTML = '<button>A</button><button>B</button><button>C</button>';
  document.head.append(style);
  document.body.append(list);
  made.push(style, list);
  return list;
};
const afterLeft = (list) => parseFloat(getComputedStyle(list, '::after').left);
const name = (button, on) => (on ? button.style.setProperty('anchor-name', '--tab-x') : button.style.removeProperty('anchor-name'));

it('a container ::after anchors to a child named through a custom property (CONTROL: no name, the fallback)', async function () {
  if (!SUPPORTED) return this.skip();
  const list = build(false);
  expect(afterLeft(list), 'CONTROL: unanchored, the fallback').to.equal(999);
  const [a, b] = list.children;
  name(b, true);
  expect(afterLeft(list), 'under B').to.equal(b.offsetLeft);
  name(b, false);
  name(a, true);
  expect(afterLeft(list), 'the name moved: under A').to.equal(a.offsetLeft);
});

it('with a transition, the anchored inset slides through values in between when the name moves (Firefox: it moves straight there)', async function () {
  if (!SUPPORTED) return this.skip();
  const list = build(true);
  const [a, , c] = list.children;
  name(a, true);
  await until(() => afterLeft(list) === a.offsetLeft, 'settled under A', 2000);
  name(a, false);
  name(c, true);
  /**
   * Asked of the transition itself, not by polling through it: a stalled main thread (WebKit under the full suite's
   * load) saw no frame inside the 400 ms and read "no value between". Paused at its midpoint, a sliding inset lies
   * strictly between A and C; an engine that moves it straight there makes no transition, or one that reads A or C.
   */
  afterLeft(list);
  const slide = document.getAnimations().find((animation) => animation.effect?.target === list && animation.effect.pseudoElement === '::after' && animation.transitionProperty === 'left');
  if (ENGINE?.name !== 'Firefox') expect(slide !== undefined, `${ON}: a transition of the list's ::after left started when the name moved`).to.equal(true);
  let between = null;
  if (slide) {
    slide.pause();
    slide.currentTime = 200;
    const left = afterLeft(list);
    if (left > a.offsetLeft && left < c.offsetLeft) between = left;
    slide.finish();
  }
  await until(() => afterLeft(list) === c.offsetLeft, 'settled under C', 3000);
  const slides = ENGINE?.name !== 'Firefox';
  expect(between !== null, `${ON}: ${slides ? 'the transition at its midpoint is between A and C: it slides' : 'no value between: it moved straight to C'}`).to.equal(slides);
});
