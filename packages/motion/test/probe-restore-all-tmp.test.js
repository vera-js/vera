import { describe, it, beforeEach, afterEach } from './harness.mjs';
import { vi } from './expect.mjs';
import { createMotion, wireMotion } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { easings } from '../src/easings.ts';
import { properties, settings as allSettings } from '../src/modules/schema.ts';

wireMotion([paint, easings]);
const P = 'data-vera-motion';

const place = (n) => {
  for (const [k, v] of [['offsetLeft', 100], ['offsetTop', 500], ['offsetWidth', 200], ['offsetHeight', 200]]) {
    Object.defineProperty(n, k, { value: v, configurable: true });
  }
  Object.defineProperty(n, 'offsetParent', { value: null, configurable: true });
};

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); document.body.innerHTML = ''; });
afterEach(() => vi.restoreAllMocks());

/** A pair of values this property will accept. */
const valuesFor = (p) => {
  if (p.category === 'paint') return ['red', 'blue'];
  const unit = p.defaultUnit ?? '';
  const lo = p.min ?? 0;
  const hi = p.max ?? (lo + 1);
  return [`${lo}${unit}`, `${Math.min(hi, lo + 1)}${unit}`];
};

const settingValue = (s) => {
  switch (s.type) {
    case 'number': return String(s.min ?? 1);
    case 'boolean': return 'true';
    case 'easing': return 'linear';
    case 'selector': return '.on';
    case 'length': return '10px';
    case 'origin': return 'top left';
    case 'offset': return '10%';
    case 'string': return s.allowed ? s.allowed[0] : 'x';
    default: return null;
  }
};

describe('probe', () => {
  it('every property and setting, photographed and demanded back', () => {
    const bad = [];
    for (const p of properties()) {
      const [a, b] = valuesFor(p);
      const markup = `<div id="t" ${P} ${P}-${p.attribute}="0% ${a}, 100% ${b}"></div>`;
      document.body.innerHTML = markup;
      place(document.getElementById('t'));
      const before = document.body.innerHTML;
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      const during = document.getElementById('t').getAttribute('style');
      m.destroy();
      if (document.body.innerHTML !== before) {
        bad.push(`PROP ${p.attribute}\n    was ${before}\n    now ${document.body.innerHTML}`);
      } else if (!during) {
        bad.push(`PROP ${p.attribute} wrote no style at all — the check is vacuous`);
      }
    }
    for (const s of allSettings()) {
      const v = settingValue(s);
      if (v === null) { bad.push(`SETTING ${s.attribute} has type ${s.type} with no sample value`); continue; }
      const markup = `<div id="t" ${P} ${P}-opacity="0% 0, 100% 1" ${P}-${s.attribute}="${v}"></div>`;
      document.body.innerHTML = markup;
      place(document.getElementById('t'));
      const before = document.body.innerHTML;
      const m = createMotion({ respectReducedMotion: false, inertia: 0 });
      m.init();
      m.destroy();
      if (document.body.innerHTML !== before) {
        bad.push(`SETTING ${s.attribute}\n    was ${before}\n    now ${document.body.innerHTML}`);
      }
    }
    console.info(`problems: ${bad.length}`);
    for (const line of bad.slice(0, 12)) console.info(line);
  });
});
