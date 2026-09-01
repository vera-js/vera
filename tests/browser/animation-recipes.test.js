/**
 * The animation recipes the renderer README gives, run in the engines they claim to work in.
 *
 * They are documentation, which is the reason to test them: a recipe that quietly stops working in
 * one engine is worse than no recipe, and one of these already does not work everywhere. Measured
 * rather than assumed, because the feature test lies — all three engines report
 * `CSS.supports('transition-behavior', 'allow-discrete')` as true and Firefox does not honour it
 * for `display`.
 */
import { expect } from '@esm-bundle/chai';

const engine = () =>
  /Firefox/.test(navigator.userAgent) ? 'firefox' : /Chrome/.test(navigator.userAgent) ? 'chromium' : 'webkit';

const withStyle = async (css, run) => {
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
  try {
    return await run();
  } finally {
    style.remove();
  }
};

const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

it('the documented ?hidden fade runs in every engine', async () => {
  await withStyle(
    `.fade { opacity: 1; transition: opacity 600ms linear; }
     .fade[hidden] { display: block; opacity: 0; pointer-events: none; }`,
    async () => {
      const element = document.createElement('div');
      element.className = 'fade';
      element.textContent = 'x';
      document.body.appendChild(element);
      /** Reading it commits the starting style; without that the change can coalesce with the
       *  append and no transition is generated at all. */
      expect(Number(getComputedStyle(element).opacity), 'starts opaque').to.equal(1);
      await frame();

      element.hidden = true;

      /**
       * **Polled, not sampled at a fixed instant.** The previous version slept 150ms into a 600ms
       * transition and asserted the value was mid-interpolation. That holds on an idle machine and
       * not on a loaded one: CI saw opacity still exactly `1`, because the transition had not begun
       * when the timer fired. The claim being made is that the element *fades rather than jumps*,
       * and any value strictly between the endpoints proves that whenever it happens to land.
       */
      let mid = null;
      for (let i = 0; i < 120 && mid === null; i++) {
        const style = getComputedStyle(element);
        expect(style.display, 'the UA hidden rule must stay overridden or there is nothing to fade').to.equal('block');
        const value = Number(style.opacity);
        if (value > 0 && value < 1) mid = value;
        else await settle(10);
      }
      expect(mid, `${engine()}: opacity never took a value between 1 and 0 — it jumped`).to.be.a('number');

      await settle(700);
      expect(Number(getComputedStyle(element).opacity)).to.equal(0);
      element.remove();
    }
  );
});

/**
 * The shape the README tells you *not* to use, pinned so the advice is checked rather than
 * remembered. If Firefox starts honouring it, this fails and the README paragraph is stale.
 */
it('display + allow-discrete still does not transition in Firefox', async () => {
  await withStyle(
    `.discrete { opacity: 1; transition: opacity 600ms linear, display 600ms allow-discrete; }
     .discrete[hidden] { opacity: 0; display: none; }`,
    async () => {
      const element = document.createElement('div');
      element.className = 'discrete';
      element.textContent = 'x';
      document.body.appendChild(element);
      await frame();

      element.hidden = true;
      await settle(150);
      const displayed = getComputedStyle(element).display !== 'none';
      if (engine() === 'firefox') {
        expect(displayed, 'Firefox began honouring allow-discrete — the README advice is now stale').to.equal(false);
      } else {
        expect(displayed, `${engine()} transitions display`).to.equal(true);
      }
      element.remove();
    }
  );
});

it('startViewTransition is available, which is what animates a real removal', () => {
  expect(typeof document.startViewTransition, `${engine()}`).to.equal('function');
});
