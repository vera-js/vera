/**
 * Markup assignment interleaved with node and attribute operations, the SSR shim against jsdom.
 *
 * `ssr-tree-sequence-fuzz` fuzzes tree mutations and found five defects that per-operation tests
 * could not see. The same reasoning points here: this DOM keeps `_entries` as a **mixed array of
 * strings and nodes** plus a `_parsed` flag, so `innerHTML = …` and `appendChild(…)` are two writers
 * to one structure, and each has to leave it in a state the other can read.
 *
 * `class` is in the mix for the same reason: it is reachable through **three** writers —
 * `setAttribute`, `className` and `classList` — over one backing value, and the interesting question
 * is whether a write through any of them is visible to all of them.
 *
 * The tree, its attributes and its text are compared after **every** step, against jsdom, on the
 * spec's own arithmetic — the same use of jsdom `ssr-tree-operations` justifies, and not as an
 * authority on anything the platform decides.
 *
 * ## Mutations
 *
 * Both halves are confirmed live. Making `classList.toggle` always add fails at seed 1234; making the
 * `innerHTML` setter leave `_parsed` set — so newly assigned markup is read back through the previous
 * parse — fails at seed 202. Each surfaces within 30 steps.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><body></body>');
const realDocument = dom.window.document;

/** Installs the shim over the globals, the way `@verajs/ssr` does. */
await import('@verajs/ssr/vera');
const shimDocument = globalThis.document;

const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);

/** Structure, attributes and text — everything a caller can read back. */
const shape = (node) => {
  const out = [];
  const walk = (parent, depth) => {
    for (const child of parent.childNodes ?? []) {
      if (child.nodeType === 3) out.push(`${depth}#text ${JSON.stringify(child.data)}`);
      else if (child.nodeType === 8) out.push(`${depth}#comment`);
      else if (child.nodeType === 1) {
        const attributes = [...child.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort();
        out.push(`${depth}<${child.localName} ${attributes.join(' ')}>`);
        walk(child, depth + 1);
      }
    }
  };
  walk(node, 0);
  return out.join('\n');
};

const MARKUP = ['<b>x</b>', '<i>a</i><i>b</i>', 'plain', '', '<p class="c">t</p>', '<span>1</span>text'];
const CLASSES = ['one', 'two', 'three'];

const build = (D) => {
  const root = D.createElement('div');
  const host = D.createElement('section');
  host.setAttribute('id', 'host');
  root.appendChild(host);
  /** A node that moves in and out of `host`, so markup writes and node writes contend. */
  const spare = D.createElement('em');
  spare.setAttribute('id', 'spare');
  spare.appendChild(D.createTextNode('spare'));
  root.appendChild(spare);
  return { root, host, spare };
};

const OPERATIONS = [
  'innerHTML', 'textContent', 'appendChild', 'insertFirst', 'removeSpare',
  'setAttribute', 'removeAttribute', 'classAdd', 'classRemove', 'classToggle', 'className', 'appendText',
];
const SEEDS = [3, 17, 44, 91, 202, 1234];
const STEPS = 30;

test('markup, node and attribute writes interleave the same way as in a real DOM', () => {
  assert.notEqual(shimDocument, realDocument, 'the shim did not install over the globals');

  const failures = [];
  let steps = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    const mine = build(shimDocument);
    const theirs = build(realDocument);
    const history = [];

    for (let step = 0; step < STEPS; step++) {
      const operation = OPERATIONS[Math.floor(random() * OPERATIONS.length)];
      const markup = MARKUP[Math.floor(random() * MARKUP.length)];
      const token = CLASSES[Math.floor(random() * CLASSES.length)];
      history.push(`${operation}(${JSON.stringify(markup).slice(0, 16)},${token})`);
      steps++;

      const apply = ({ host, spare }) => {
        try {
          switch (operation) {
            case 'innerHTML': host.innerHTML = markup; break;
            case 'textContent': host.textContent = markup; break;
            case 'appendChild': host.appendChild(spare); break;
            case 'insertFirst': host.insertBefore(spare, host.firstChild); break;
            case 'removeSpare': spare.remove(); break;
            case 'setAttribute': host.setAttribute('data-k', token); break;
            case 'removeAttribute': host.removeAttribute('data-k'); break;
            case 'classAdd': host.classList.add(token); break;
            case 'classRemove': host.classList.remove(token); break;
            case 'classToggle': host.classList.toggle(token); break;
            case 'className': host.className = token; break;
            case 'appendText': host.appendChild(host.ownerDocument.createTextNode(token)); break;
          }
          return null;
        } catch (error) {
          return error.name ?? error.constructor.name;
        }
      };

      const threwShim = apply(mine);
      const threwReal = apply(theirs);
      const where = `seed ${seed} step ${step}, after ${history.slice(-4).join(' ')}`;

      if (threwShim !== threwReal) {
        failures.push(`${where}\n      shim threw ${threwShim}, jsdom threw ${threwReal}`);
        break;
      }

      const fromShim = shape(mine.root);
      const fromReal = shape(theirs.root);
      if (fromShim !== fromReal) {
        failures.push(
          `${where}\n      shim:  ${fromShim.replace(/\n/g, ' | ').slice(0, 240)}\n      jsdom: ${fromReal.replace(/\n/g, ' | ').slice(0, 240)}`
        );
        /** Everything after a divergence is a consequence of it, not a second finding. */
        break;
      }
    }
  }

  assert.ok(steps >= SEEDS.length * STEPS, `only ${steps} operations ran — a sequence stopped early without reporting`);
  assert.deepEqual(
    failures.slice(0, 6),
    [],
    `${failures.length} sequence(s) diverged from jsdom:\n\n  ${failures.slice(0, 6).join('\n\n  ')}`
  );
});
