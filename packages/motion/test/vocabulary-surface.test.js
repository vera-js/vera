import { describe, it } from './harness.mjs';
import { expect } from './expect.mjs';
import {
  PROPERTIES, SETTINGS, properties, settings, parseMeasure, getProperty, wireMotion,
} from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { sequence } from '../src/sequence.ts';
import { split } from '../src/split.ts';

wireMotion([paint, sequence(), split]);

const names = (list) => list.map((entry) => entry.attribute);

/**
 * The vocabulary is published so a GUI can generate controls from the same
 * definition the runtime parses with. `PROPERTIES` and `SETTINGS` are the
 * built-in tables and stop there, so a GUI iterating them offers none of the
 * attributes a module contributed — silently, because every one of them still
 * parses and animates perfectly well when written by hand.
 */
describe('the published vocabulary includes wired modules', () => {
  it('lists module properties that the built-in table does not', () => {
    for (const attribute of ['background', 'color', 'border-color', 'shadow', 'text-shadow', 'frame']) {
      expect(names(PROPERTIES), `PROPERTIES is the built-ins only`).not.toContain(attribute);
      expect(names(properties()), `properties() must include ${attribute}`).toContain(attribute);
    }
  });

  it('lists module settings that the built-in table does not', () => {
    for (const attribute of ['frame-url', 'frame-count', 'frame-pad', 'frame-ext', 'split']) {
      expect(names(SETTINGS)).not.toContain(attribute);
      expect(names(settings()), `settings() must include ${attribute}`).toContain(attribute);
    }
  });

  it('still lists every built-in', () => {
    for (const attribute of names(PROPERTIES)) expect(names(properties())).toContain(attribute);
    for (const attribute of names(SETTINGS)) expect(names(settings())).toContain(attribute);
  });

  it('agrees with getProperty, which reads the same registry', () => {
    for (const entry of properties()) expect(getProperty(entry.attribute)).toBe(entry);
  });

  /**
   * A GUI validates a control's input with the same function the runtime
   * parses markup with, or a control accepts a value the page then rejects.
   */
  it('exports parseMeasure, so a control cannot accept what the page refuses', () => {
    expect(parseMeasure('40px', getProperty('translate-y'))).toEqual({ value: 40, unit: 'px' });
    expect(parseMeasure('40deg', getProperty('translate-y'))).toBeNull();
    /** And it reaches a module's own validator, not just the built-in grammar. */
    expect(parseMeasure('rgb(1, 2, 3)', getProperty('background'))).not.toBeNull();
    expect(parseMeasure('url(x.png)', getProperty('background'))).toBeNull();
  });
});
