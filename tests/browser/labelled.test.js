/**
 * **What `labelled` writes, as the browser reads it**: the accessible name and description each engine computes, a
 * label click focusing its control, and axe-core over every state. The jsdom suites (`tests/hook-labelled*.test.mjs`)
 * hold what the hook WRITES; only a real engine says what those writes MEAN, so these rows are the oracle for that half.
 *
 * Correctness only. These run headless, which is fine for what a page computes and wrong for anything timed: never
 * time with this suite (CLAUDE.md, "time in headed browsers").
 *
 * axe ships UMD and is loaded as a script tag, as `select-axe.test.js` loads it.
 *
 * No row reads the engine's accessibility TREE: `a11ySnapshot` needs Playwright's `page.accessibility`, which the pinned
 * Playwright (1.62) no longer has, and its replacement (`ariaSnapshot`) is Playwright's own computation, the same code on
 * every engine, so it would be no oracle. What the ENGINE computes is asserted instead: `control.labels` (the platform's
 * label association) and a label click focusing the control; the names and descriptions are audited by axe's rules
 * (`label`, `aria-input-field-name`), each with a control that axe reports the unwired case.
 */
import { expect } from '@esm-bundle/chai';
import { labelled } from '../../packages/hooks/labelled/dist/development/vera-labelled.js';

await new Promise((resolve, reject) => {
  const script = document.createElement('script');
  script.src = '/node_modules/axe-core/axe.min.js';
  script.onload = resolve;
  script.onerror = reject;
  document.head.appendChild(script);
});

/** A fresh fixture holding `markup`, removed after each test. */
let fixture;
const mount = (markup) => {
  fixture = document.createElement('div');
  fixture.innerHTML = markup;
  document.body.append(fixture);
  return (selector) => fixture.querySelector(selector);
};
afterEach(() => fixture?.remove());

/** axe over the fixture: zero violations is the gate. */
const audit = async () => {
  const { violations } = await globalThis.axe.run(fixture, { resultTypes: ['violations'] });
  return violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
};


describe('labelled in a real engine', () => {
  it('a label click focuses the wired control', () => {
    const q = mount('<label>Email</label><input>');
    labelled(q('input'), { host: fixture, label: q('label') });
    q('label').click();
    expect(document.activeElement === q('input')).to.equal(true);
  });

  it('the engine associates the label with the control (control.labels)', () => {
    const q = mount('<label>Email</label><input class="wired"><input class="bare">');
    labelled(q('.wired'), { host: fixture, label: q('label') });
    /** Read only AFTER wiring: Firefox never updates a `labels` list read before the `for` was set (the row below). */
    expect([...q('.wired').labels].includes(q('label'))).to.equal(true);
    expect(q('.bare').labels.length, 'CONTROL: the unwired input has no label').to.equal(0);
  });

  /**
   * **The engines' rule, recorded (BROWSER-LEDGER, 2026-11-20):** a control's `labels`, once read, is not updated in
   * Firefox when a label's `for` is set to the control's id afterwards; Chromium and WebKit update it, as the live
   * NodeList the spec describes. The label still works in Firefox (a click focuses the control; the row above). So code
   * must never decide "is this control labelled" from a `labels` it may have read earlier; `labelled` compares each
   * label's `for` instead. If this row fails on Firefox, the engine changed: update the ledger, not the assertion.
   */
  it('ENGINE RULE: a labels list read before the for is set is stale in Firefox only', () => {
    const q = mount('<label>Email</label><input id="ff-labels">');
    const before = q('input').labels.length;
    q('label').setAttribute('for', 'ff-labels');
    const after = q('input').labels.length;
    const firefox = /Firefox\//.test(navigator.userAgent);
    expect(before).to.equal(0);
    expect(after, firefox ? 'Firefox keeps the stale list' : 'a live list').to.equal(firefox ? 0 : 1);
  });

  it('a non-labelable focus target is named through aria-labelledby, and axe agrees', async () => {
    const q = mount('<label>Fruit</label><div role="combobox" tabindex="0" aria-expanded="false" aria-controls="lb"></div><div id="lb" role="listbox"></div>');
    /** CONTROL: unwired, axe reports the unnamed combobox. */
    expect((await audit()).some((line) => line.startsWith('aria-input-field-name:')), 'axe reports the unnamed combobox').to.equal(true);
    labelled(q('[role="combobox"]'), { host: fixture, label: q('label') });
    expect(await audit()).to.deep.equal([]);
  });

  it('axe finds nothing wired, with an error shown, and after release', async () => {
    const q = mount('<label>Name</label><input><p class="hint">Your full name</p><p class="error" hidden>Required</p>');
    const wiring = labelled(q('input'), { host: fixture, label: q('label'), hint: q('.hint'), errors: [q('.error')] });
    expect(await audit(), 'wired').to.deep.equal([]);
    q('.error').hidden = false;
    wiring.show(q('.error'));
    expect(q('input').getAttribute('aria-invalid')).to.equal('true');
    expect(await audit(), 'error shown').to.deep.equal([]);
    wiring.release();
    q('label').setAttribute('for', 'nothing');
    /** CONTROL: unwired, the input has no name, and axe must say so, or the zeros above prove nothing. */
    expect((await audit()).some((line) => line.startsWith('label:')), 'axe reports the unnamed input').to.equal(true);
  });
});
