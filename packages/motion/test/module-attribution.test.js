/**
 * `from`: which module an attribute came from, asked rather than deduced.
 *
 * A GUI panel iterating the vocabulary could describe an attribute completely
 * and still not tell an author what to import to make it work — the one
 * sentence they need when a module is not wired. Both `generate-reference.js`
 * and `check-examples.js` had grown the same workaround (wire one module at a
 * time, diff the registry), which is what argued for the field.
 *
 * Absent means core's own, so the 22 built-ins carry no string; audit rule 29
 * holds every module definition to declaring one.
 */
import { describe, it, before } from './harness.mjs';
import { expect } from './expect.mjs';
import { wireMotion, properties, settings, getProperty } from '../src/index.ts';
import { paint } from '../src/paint.ts';
import { path } from '../src/path.ts';
import { split } from '../src/split.ts';
import { sequence } from '../src/sequence.ts';

before(() => { wireMotion([paint, path, split, sequence()]); });

describe('an attribute names the module that contributes it', () => {
  it("leaves core's own attributes unattributed", () => {
    /** The control: absent, not `'core'` — the built-ins carry no string at all. */
    expect(getProperty('translate-y').from).toBeUndefined();
    expect(getProperty('opacity').from).toBeUndefined();
  });

  it('names the specifier a GUI would tell an author to import', () => {
    expect(getProperty('background').from).toBe('@verajs/motion/paint');
    expect(getProperty('path').from).toBe('@verajs/motion/path');
    expect(getProperty('frame').from).toBe('@verajs/motion/sequence');
  });

  it('attributes module settings too, not only properties', () => {
    const byName = new Map(settings().map((s) => [s.attribute, s]));
    expect(byName.get('split').from).toBe('@verajs/motion/split');
    expect(byName.get('frame-url').from).toBe('@verajs/motion/sequence');
    expect(byName.get('frame-tween').from).toBe('@verajs/motion/sequence');
    /** And a core setting stays unattributed, the same control as above. */
    expect(byName.get('inertia').from).toBeUndefined();
  });

  it('is a specifier that can actually be imported, for every module entry', () => {
    const attributed = [...properties(), ...settings()].filter((entry) => entry.from);
    /** The control: a run where nothing is attributed proves nothing. */
    expect(attributed.length > 0).toBe(true);
    for (const entry of attributed) {
      expect(entry.from.startsWith('@verajs/motion/')).toBe(true);
    }
  });
});
