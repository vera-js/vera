import { expect } from '@esm-bundle/chai';

/**
 * **The example pages, loaded and OPERATED — because two of them were dead for days under captions
 * describing a working demo.**
 *
 * `examples/light-slots/` died resolving a bundle external its import map did not declare;
 * `examples/ui-select/` died the same way through a dynamic import the map guard could not yet see;
 * and light-slots' centrepiece counter was frozen by design even once the page loaded. Every one of
 * those shipped, because examples are pages only humans open, and humans had not. The import-map
 * guard now covers the load-time half mechanically; this file is the behavioural half: each page is
 * loaded into a same-origin iframe (the runner serves the repo root, so `/examples/...` is simply
 * there, production bundles included) and its HEADLINE claims are exercised — not every caption,
 * but the ones whose failure means the page is lying: does it render, and does its one advertised
 * interaction do the advertised thing.
 *
 * Waits poll for the CONDITION rather than sleeping a chosen duration — the recorded lesson from
 * the Firefox history test — and reads name the exact element that owns each fact, because three
 * probe runs in a row misread this component by asking the host for state it reports onto the
 * user's own markup (button gets `data-state`, the value span gets `data-label`).
 */
const settleFrames = (win, count = 2) =>
  new Promise((resolve) => {
    const step = (left) => (left <= 0 ? resolve() : win.requestAnimationFrame(() => step(left - 1)));
    step(count);
  });

const until = async (probe, label, tries = 60) => {
  for (let i = 0; i < tries; i++) {
    const value = probe();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for: ${label}`);
};

let frame;
afterEach(() => {
  frame?.remove();
  frame = null;
});

const openPage = async (path) => {
  frame = document.createElement('iframe');
  frame.style.cssText = 'width:900px;height:700px';
  frame.src = path;
  document.body.appendChild(frame);
  await new Promise((resolve) => (frame.onload = resolve));
  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  return { doc, win };
};

it('light-slots: renders both modes, and the advertised counter actually counts', async () => {
  const { doc, win } = await openPage('/examples/light-slots/index.html');

  /** Dead-page detector first: the module script defines the cards, so their content renders. */
  await until(() => doc.querySelector('info-card[light] header')?.textContent.includes('Light DOM'),
    'the light card rendered its slotted title');
  const shadowCard = doc.querySelector('info-card:not([light])');
  expect(shadowCard.shadowRoot, 'the shadow twin attached its root').to.not.equal(null);

  /** The centrepiece: "Move the badge" must move the METER, which is the claim that sat frozen. */
  const meter = () => doc.querySelector('#movable-host .meter')?.textContent ?? '';
  await until(() => /fired \d+×/.test(meter()), 'the meter rendered');
  const before = meter();
  doc.querySelector('#mover').click();
  await settleFrames(win);
  await until(() => meter() !== before, `the counter advanced past ${JSON.stringify(before)}`);

  /** And the real-component section: the page's own fancy button is the slotted trigger. */
  await until(() => doc.querySelector('vera-select[light] button.fancy'),
    'the slotted trigger is inside the select');
});

it('ui-select: ten selects upgrade, the unwired-light card operates, the slotted card reports back', async () => {
  const { doc, win } = await openPage('/examples/ui-select/index.html');

  /** Dead-page detector: every select upgrades (shadow root, or light-mode parts). */
  await until(() => {
    const all = [...doc.querySelectorAll('vera-select')];
    return all.length === 10 && all.every((s) => s.shadowRoot || s.querySelector('[part]')) && all;
  }, 'all ten selects upgraded');

  /** The unwired-light configuration the feature doc calls supported. */
  const light = doc.getElementById('light');
  expect(light.shadowRoot, 'light mode: no shadow root').to.equal(null);
  const trigger = light.querySelector("[part='trigger']");
  expect(trigger, 'parts answer plain page queries').to.not.equal(null);
  trigger.click();
  await settleFrames(win);
  await until(() => light.querySelector("[part='menu']")?.getAttribute('data-state') === 'open',
    'the light select opens');
  light.querySelector("[part='option']").click();
  await settleFrames(win);
  await until(() => /\S/.test(trigger.textContent), 'the pick landed in the trigger');

  /** The slotted card: state reported onto the USER'S markup, where the page's CSS reads it. */
  const fancy = doc.querySelector('#slotted button.fancy-trigger');
  fancy.click();
  await settleFrames(win);
  await until(() => fancy.getAttribute('data-state') === 'open',
    "data-state='open' lands on the page's own button");
  doc.getElementById('slotted').shadowRoot.querySelector("[part='option']").click();
  await settleFrames(win);
  await until(() => doc.querySelector("#slotted [slot='value']")?.getAttribute('data-label'),
    'data-label lands on the value span, for content: attr(data-label)');
});

it('directives showcase: routes render, the hello-world taps, motion clamps, the diagnostics gallery refuses without breaking', async () => {
  const { doc, win } = await openPage('/examples/directives/index.html');

  /** Dead-page detector: the router rendered the overview, and demo-block restructured. */
  await until(() => doc.querySelector('main h1')?.textContent.includes('Every directive'),
    'the overview route rendered');
  await until(() => doc.querySelector('demo-block .demo-live'), 'demo-block built its live/source split');
  await until(() => doc.querySelector('vocab-table tbody tr'), 'describeDirectives filled the vocabulary');

  /** The hello world: a directive click advances directive state on screen. */
  const tapPill = () => doc.querySelector('.demo-live .pill')?.textContent ?? '';
  await until(() => tapPill() === '0', 'the tap counter activated at 0');
  doc.querySelector('.demo-live button[data-vd-on-click]').click();
  await until(() => tapPill() === '1', 'the tap advanced');

  /**
   * Route to Motion: presets ACTIVATE and honour their trigger. Since the shipped presets gained
   * `scroll: '85%', play: 0.6`, "the first fade-up sits at its first keyframe" stopped being true —
   * an on-screen instance has crossed the line and PLAYED to 1. So the probe asserts the semantics
   * from whichever side of the fold the page actually puts its instances: below the line → 0,
   * above it → ramps to 1. Either way the generated mark proves activation through the real
   * pipeline, computed style proves the rule applied.
   */
  doc.querySelector('a[route][href$="/motion"]').click();
  await until(() => doc.querySelector('[data-vd-motion="fade-up"][data-vd-a]'),
    'a preset activated onto the generated path');
  /**
   * The COMPUTED FILTER, not the opacity property — the generated rule animates
   * `filter: opacity()`, and reading `.opacity` cost a day's WebKit hunt: it is 1 in every
   * engine forever, so the above-the-line branch passed VACUOUSLY on Chromium/Firefox while
   * WebKit's layout (every hero below the line) demanded a value the untouched property could
   * never show. A probe on the wrong property is the probe-that-measures-nothing with better
   * camouflage; the `!== null` control below is what refuses the vacuous pass now.
   */
  const filterOpacity = (el) => {
    const filter = doc.defaultView.getComputedStyle(el).filter;
    const match = /opacity\(([\d.]+)\)/.exec(filter);
    return match ? Number(match[1]) : null;
  };
  await until(() => {
    const heroes = [...doc.querySelectorAll('[data-vd-motion="fade-up"][data-vd-a]')];
    const line = win.innerHeight * 0.85;
    return heroes.some((hero) => {
      const opacity = filterOpacity(hero);
      if (opacity === null) return false;
      const top = hero.getBoundingClientRect().top;
      return top > line ? opacity < 0.01 : opacity > 0.99;
    });
  }, 'a preset sits at the end its trigger line dictates');

  /** Route to Diagnostics: the deliberate mistakes are ALIVE as refusals, page intact. */
  doc.querySelector('a[route][href$="/diagnostics"]').click();
  await until(() => doc.querySelector('rejections-panel li'), 'the refusal panel filled');
  const panel = () => doc.querySelector('rejections-panel')?.textContent ?? '';
  await until(() => /unknown-directive/.test(panel()), 'the unknown directive earned its code');
  await until(() => /strict-spelling/.test(panel()), 'and === earned the teaching refusal');
  await settleFrames(win);
  expect(doc.querySelector('main h1').textContent, 'the page survived its own mistake gallery')
    .to.include('Diagnostics');
});
