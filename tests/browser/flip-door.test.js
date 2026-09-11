/**
 * The flip door against REAL view transitions — browser truth for the flagship, on all three
 * engines (each ships same-document startViewTransition; measured 2026-09-11).
 *
 * Assertions are STRING/NUMBER fields only — never node identity. A failing chai equality on
 * DOM elements drags the engine's object graph into the diff and kills the runner's reporter,
 * which reads as a timeout with zero tests run (the motion-verify scar).
 */
import { expect } from '@esm-bundle/chai';
import { wireDirectives, interactions, expressions, query, settled, stateOf }
  from '../../packages/directives/dist/development/vera-directives.js';

wireDirectives([expressions, ...interactions, query]);

/** Count real transitions by wrapping the platform's own method — and keep its behavior. */
const native = document.startViewTransition?.bind(document);
let transitions = 0;
let last = null;
if (native) {
  document.startViewTransition = (cb) => {
    transitions++;
    last = native(cb);
    return last;
  };
}

it('a sort change rides a REAL view transition; typing and establishment never do', async function () {
  if (!native) this.skip(); /* an engine without VT is the designed instant floor */
  const host = document.createElement('div');
  host.innerHTML = `
    <div data-vd-state="{ s: '', q: '' }">
      <ul data-vd-list="{ items: 'li', sort: 's', search: 'q', animate: true }">
        <li data-price="3">b</li><li data-price="1">a</li><li data-price="2">c</li>
      </ul>
    </div>`;
  document.body.appendChild(host);
  await settled();
  const baseline = transitions;
  expect(baseline, 'establishment (activation) did not animate').to.equal(0);

  const state = stateOf(host.firstElementChild);
  state.s = 'price';
  await settled();
  await new Promise((r) => setTimeout(r, 30));
  expect(transitions - baseline, 'one REAL transition for the sort').to.equal(1);
  await last.finished;
  const order = [...host.querySelectorAll('li')].filter((li) => !li.hidden).map((li) => li.textContent).join('');
  expect(order, 'the reorder landed through the async commit').to.equal('acb');
  const residue = [...host.querySelectorAll('li')]
    .filter((li) => li.style.getPropertyValue('view-transition-name')).length;
  expect(residue, 'transient names cleared after finished').to.equal(0);
  expect(document.getElementById('vm-fx-stagger'), 'the stagger sheet is gone').to.equal(null);

  state.q = 'a';
  await settled();
  await new Promise((r) => setTimeout(r, 30));
  expect(transitions - baseline, 'typing stayed instant').to.equal(1);
  host.remove();
  await settled();
});
