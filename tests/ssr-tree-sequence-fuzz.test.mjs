/**
 * Random **sequences** of tree mutations, the SSR shim against jsdom.
 *
 * `ssr-dom-differential` asks whether each member behaves like the one it imitates. `ssr-tree-operations`
 * asks the same of the four operations that need a tree. Both check operations **one at a time**, and
 * every member they cover already agreed.
 *
 * A DOM implementation can answer every individual call correctly and still build the wrong tree,
 * because the interesting failures are about state carried *between* calls — and, as it turned out
 * here, about a node being its own argument. Five defects came out of this file's first run; each is
 * documented at its fix in `nodes.js`:
 *
 * | | symptom |
 * | --- | --- |
 * | `insertBefore(x, x)` | `x` landed at index `n - 2` — first with two children, second-to-last with five, and **correct with three**, which is the size a hand-written case uses |
 * | `replaceChild` | the only insertion path with no ancestor check, so a node could be made to contain itself |
 * | `prepend` | moved the children aside, and destroyed them all if `append` then threw |
 * | `x.replaceWith(x)` | deleted `x` |
 * | `x.replaceChild(x, x)` | moved `x` to the end and destroyed the last child |
 *
 * Three of the five are one root cause: the file treated a node and its own argument as necessarily
 * different, and every one of these operations allows them to be the same.
 *
 * ## Why this is a fair use of jsdom
 *
 * `CLAUDE.md` says jsdom is the regression net and never the oracle for anything the *platform*
 * decides. This is the spec's tree arithmetic — the same reasoning `ssr-tree-operations` gives — not
 * an engine's judgement call, and every case here is one the spec states outright.
 *
 * ## Two properties of the harness that matter
 *
 * The tree is compared after **every step**, not at the end: a sequence that diverges at step 3 and
 * runs to 25 reports whatever the last step happened to leave behind. And the same generated indices
 * drive both sides, so the two sequences are genuinely the same sequence rather than two similar ones.
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

/** Tag names, attributes and text, depth-first — enough to see a node in the wrong place or gone. */
const shape = (node) => {
  const out = [];
  const walk = (parent, depth) => {
    for (const child of parent.childNodes ?? []) {
      if (child.nodeType === 3) out.push(`${depth}#text ${JSON.stringify(child.data)}`);
      else if (child.nodeType === 1) {
        out.push(`${depth}<${child.localName} id=${child.getAttribute('id') ?? '-'}>`);
        walk(child, depth + 1);
      }
    }
  };
  walk(node, 0);
  return out.join('\n');
};

const build = (D) => {
  const root = D.createElement('div');
  const nodes = [root];
  for (let i = 0; i < 6; i++) {
    const element = D.createElement(i % 2 ? 'span' : 'p');
    element.setAttribute('id', `n${i}`);
    element.appendChild(D.createTextNode(`t${i}`));
    root.appendChild(element);
    nodes.push(element);
  }
  return { root, nodes };
};

const OPERATIONS = ['appendChild', 'insertBefore', 'replaceChild', 'removeChild', 'prepend', 'before', 'after', 'replaceWith', 'remove'];
const SEEDS = [2, 13, 29, 61, 137, 999];
const STEPS = 25;

test('the shim and jsdom build the same tree through any sequence of mutations', () => {
  assert.notEqual(shimDocument, realDocument, 'the shim did not install over the globals');

  const failures = [];
  let mutations = 0;

  for (const seed of SEEDS) {
    const random = rng(seed);
    const mine = build(shimDocument);
    const theirs = build(realDocument);
    const history = [];

    for (let step = 0; step < STEPS; step++) {
      const operation = OPERATIONS[Math.floor(random() * OPERATIONS.length)];
      const i = Math.floor(random() * mine.nodes.length);
      const j = Math.floor(random() * mine.nodes.length);
      history.push(`${operation}(${i},${j})`);
      mutations++;

      const apply = ({ nodes }) => {
        const target = nodes[i];
        const other = nodes[j];
        try {
          switch (operation) {
            case 'appendChild': target.appendChild(other); break;
            case 'insertBefore': target.insertBefore(other, target.firstChild); break;
            case 'replaceChild': if (target.firstChild) target.replaceChild(other, target.firstChild); break;
            case 'removeChild': if (other.parentNode === target) target.removeChild(other); break;
            case 'prepend': target.prepend(other); break;
            case 'before': target.before(other); break;
            case 'after': target.after(other); break;
            case 'replaceWith': target.replaceWith(other); break;
            case 'remove': target.remove(); break;
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
          `${where}\n      shim:  ${fromShim.replace(/\n/g, ' | ').slice(0, 220)}\n      jsdom: ${fromReal.replace(/\n/g, ' | ').slice(0, 220)}`
        );
        /** Stop this sequence: everything after a divergence is a consequence of it, not a finding. */
        break;
      }
    }
  }

  assert.ok(mutations >= SEEDS.length * STEPS, `only ${mutations} mutations ran — a sequence stopped early without reporting`);
  assert.deepEqual(
    failures.slice(0, 6),
    [],
    `${failures.length} sequence(s) diverged from jsdom:\n\n  ${failures.slice(0, 6).join('\n\n  ')}`
  );
});
