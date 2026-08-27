/**
 * A **server-rendered** keyed list, adopted and then reordered.
 *
 * Keying earns its keep by moving the node a key already has rather than rebuilding it — that is
 * what preserves focus, scroll, media playback and whatever a third-party library attached. Over
 * server markup the nodes it must move are ones **it did not create**, which is the case a keyed
 * renderer can get wrong while looking entirely correct: the order comes out right and every node
 * is new.
 *
 * So each step holds references to the server's own nodes and checks they are still the ones on the
 * page after the list has been reversed, shortened, grown and emptied.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, shallowRef, untrack } from '../../packages/core/dist/development/vera.js';
import { renderInto as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';
import { keyed } from '../../packages/renderer/dist/development/vera-renderer-keyed.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const ROWS = ['a', 'b', 'c', 'd'];

customElements.define(
  'keyed-hydrate-probe',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const rows = shallowRef([...ROWS]);
      this.rows = rows;
      this.set = (next) => (rows.value = next);
      this.current = () => untrack(() => rows.value);
      render(
        () => html`<ul id="list">${rows.value.map((row) => keyed(row, html`<li data-id=${row}>${row}</li>`))}</ul>`
      );
    }
  }
);

/** Exactly what `@verajs/ssr` emits for the list above. */
const SERVER = `<template shadowrootmode="open"><ul id="list"><li data-id="a">a</li><li data-id="b">b</li><li data-id="c">c</li><li data-id="d">d</li></ul></template>`;

const mount = async () => {
  const host = document.createElement('div');
  host.setHTMLUnsafe(`<keyed-hydrate-probe>${SERVER}</keyed-hydrate-probe>`);
  document.body.appendChild(host);
  const element = host.firstElementChild;
  /** Held **before** the component upgrades: these are the server's nodes and nobody else's. */
  const serverNodes = new Map(
    [...element.shadowRoot.querySelectorAll('li')].map((li) => [li.dataset.id, li])
  );
  expect(serverNodes.size, 'the server markup has no rows').to.equal(4);

  customElements.upgrade(element);
  await frame();
  await frame();
  return { element, serverNodes };
};

const idsIn = (element) => [...element.shadowRoot.querySelectorAll('li')].map((li) => li.dataset.id);
const nodeFor = (element, id) => element.shadowRoot.querySelector(`li[data-id="${id}"]`);

describe('a keyed list adopted from server markup', () => {
  it('adopts every row rather than rebuilding them', async () => {
    const { element, serverNodes } = await mount();
    expect(idsIn(element)).to.deep.equal(ROWS);
    for (const id of ROWS)
      expect(nodeFor(element, id), `row "${id}" was rebuilt rather than adopted`).to.equal(serverNodes.get(id));
  });

  it('moves the server’s nodes when the order changes', async () => {
    const { element, serverNodes } = await mount();
    element.set(['d', 'c', 'b', 'a']);
    await frame();

    expect(idsIn(element)).to.deep.equal(['d', 'c', 'b', 'a']);
    for (const id of ROWS)
      expect(nodeFor(element, id), `row "${id}" was rebuilt on reorder instead of moved`).to.equal(
        serverNodes.get(id)
      );
  });

  it('keeps state a user put into an adopted row across a reorder', async () => {
    const { element, serverNodes } = await mount();
    /** Something only that exact node can carry — a rebuild loses it silently. */
    serverNodes.get('b').dataset.touched = 'by the user';

    element.set(['c', 'b', 'a', 'd']);
    await frame();
    expect(nodeFor(element, 'b').dataset.touched, 'the row was rebuilt and the state went with it').to.equal(
      'by the user'
    );
  });

  it('removes rows without disturbing the ones that stay', async () => {
    const { element, serverNodes } = await mount();
    element.set(['a', 'd']);
    await frame();

    expect(idsIn(element)).to.deep.equal(['a', 'd']);
    expect(nodeFor(element, 'a')).to.equal(serverNodes.get('a'));
    expect(nodeFor(element, 'd')).to.equal(serverNodes.get('d'));
  });

  it('adds rows around adopted ones', async () => {
    const { element, serverNodes } = await mount();
    element.set(['new-first', 'a', 'b', 'new-middle', 'c', 'd', 'new-last']);
    await frame();

    expect(idsIn(element)).to.deep.equal(['new-first', 'a', 'b', 'new-middle', 'c', 'd', 'new-last']);
    for (const id of ROWS)
      expect(nodeFor(element, id), `adopted row "${id}" was rebuilt when new rows arrived`).to.equal(
        serverNodes.get(id)
      );
  });

  it('empties and refills correctly', async () => {
    const { element } = await mount();
    element.set([]);
    await frame();
    expect(idsIn(element)).to.deep.equal([]);

    element.set(['x', 'y']);
    await frame();
    expect(idsIn(element)).to.deep.equal(['x', 'y']);
  });

  it('survives a reorder that arrives in the same turn as a removal', async () => {
    const { element, serverNodes } = await mount();
    element.set(['d', 'b']);
    element.set(['b', 'd']);
    await frame();

    expect(idsIn(element)).to.deep.equal(['b', 'd']);
    expect(nodeFor(element, 'b')).to.equal(serverNodes.get('b'));
    expect(nodeFor(element, 'd')).to.equal(serverNodes.get('d'));
  });
});
