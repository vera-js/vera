/**
 * **What hydration does to work the user did before the JavaScript arrived.**
 *
 * This is the whole reason server rendering exists — the page is usable before the bundle lands —
 * and it is therefore the window in which a real person types into a field, ticks a box, picks an
 * option or scrolls. Hydration then runs against a DOM that no longer matches what the server sent.
 *
 * There is no `live()` in this renderer: a property bound to a value it already holds is not
 * re-applied, which is what keeps a field the user has typed into. Whether that also holds when the
 * *server's* value is the one being adopted is a different question, and the one that decides
 * whether an SSR page is safe to interact with early.
 *
 * Each case does the thing a person would do, then hydrates, then asks what survived.
 */
import { expect } from '@esm-bundle/chai';
import { wire, init, render, html, createStore } from '../../packages/core/dist/development/vera.js';
import { render as hydratingRender } from '../../packages/renderer/dist/development/vera-renderer-hydrate.js';

wire({ on: 'render', fn: hydratingRender, priority: 50 });
const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/** Exactly what `@verajs/ssr` emits for the component below, with the server's values in place. */
const SERVER = `<template shadowrootmode="open"><form id="root">
        <input id="text" value="Ada" />
        <input id="box" type="checkbox" />
        <select id="pick"><option value="a" selected>a</option><option value="b">b</option></select>
        <textarea id="area">server text</textarea>
        <p id="count">0</p>
      </form></template>`;

/**
 * Defined lazily, and under a fresh tag each time — because **when** the definition lands is the
 * whole subject.
 *
 * A custom element upgrades the moment it is inserted into a document with its tag already
 * defined, so defining at module scope and appending the fixture ran `connectedCallback`, `init`
 * and the hydrating `render` synchronously, right there in the append. Everything the helper did
 * afterwards — the "user" typing, the explicit `customElements.upgrade` — happened to a component
 * that had already hydrated, so every assertion in this file was true by construction. The suite
 * could not fail, and did not, while the case it names was broken.
 *
 * Defining afterwards is also what actually happens on a page: the markup arrives, a person
 * interacts with it, and then the bundle lands and defines the element. It is the only ordering
 * where the DOM is connected while it is touched, which `focus()` requires — a detached element
 * cannot take focus, so the caret case is untestable any other way.
 */
let probeSeq = 0;
const defineProbe = (tag) =>
  customElements.define(
    tag,
    class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ name: 'Ada', ticked: false, picked: 'a', note: 'server text', count: 0 });
      this.state = state;
      render(
        () => html`<form id="root">
        <input id="text" .value=${state.name} />
        <input id="box" type="checkbox" .checked=${state.ticked} />
        <select id="pick"><option value="a" .selected=${state.picked === 'a'}>a</option><option value="b" .selected=${state.picked === 'b'}>b</option></select>
        <textarea id="area" .value=${state.note}></textarea>
        <p id="count">${state.count}</p>
      </form>`
      );
      }
    }
  );

/** Parse the server markup into the page, let a real user touch it, and only then define the tag. */
const hydrateAfter = async (touch) => {
  const tag = `user-state-probe-${probeSeq++}`;
  const host = document.createElement('div');
  host.setHTMLUnsafe(`<${tag}>${SERVER}</${tag}>`);
  document.body.appendChild(host);
  const element = host.firstElementChild;
  const shadow = element.shadowRoot;
  expect(shadow, 'declarative shadow DOM did not parse').to.exist;
  expect(customElements.get(tag), 'the element must still be undefined here').to.equal(undefined);
  expect(shadow.querySelector('#area').textContent, 'the fixture must carry the value the server writes as a textarea’s content').to.equal('server text');

  touch(shadow);

  defineProbe(tag);
  await frame();
  await frame();
  return { element, shadow };
};

describe('hydration over a DOM the user already touched', () => {
  it('keeps what the user typed into a text field', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    expect(shadow.querySelector('#text').value, 'the user’s text was overwritten by the server’s').to.equal(
      'Grace'
    );
  });

  it('keeps a checkbox the user ticked', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#box').checked = true));
    expect(shadow.querySelector('#box').checked, 'the user’s tick was undone').to.equal(true);
  });

  it('keeps a select the user changed', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#pick').value = 'b'));
    expect(shadow.querySelector('#pick').value, 'the user’s choice was reset').to.equal('b');
  });

  it('keeps what the user typed into a textarea', async () => {
    const { shadow } = await hydrateAfter((root) => (root.querySelector('#area').value = 'typed by hand'));
    expect(shadow.querySelector('#area').value, 'the user’s text was replaced').to.equal('typed by hand');
  });

  it('keeps focus and the caret where the user left them', async () => {
    const { shadow } = await hydrateAfter((root) => {
      const field = root.querySelector('#text');
      field.focus();
      field.setSelectionRange(1, 2);
    });
    const field = shadow.querySelector('#text');
    expect(shadow.activeElement, 'focus was lost through hydration').to.equal(field);
    expect([field.selectionStart, field.selectionEnd], 'the caret moved').to.deep.equal([1, 2]);
  });

  it('still updates that field when the state actually changes', async () => {
    const { element, shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    element.state.name = 'Katherine';
    await frame();
    expect(
      shadow.querySelector('#text').value,
      'the field stopped following its binding after hydration'
    ).to.equal('Katherine');
  });

  it('and the rest of the component hydrated normally', async () => {
    const { element, shadow } = await hydrateAfter((root) => (root.querySelector('#text').value = 'Grace'));
    const paragraph = shadow.querySelector('#count');
    element.state.count = 5;
    await frame();
    expect(shadow.querySelector('#count'), 'the untouched part was rebuilt').to.equal(paragraph);
    expect(paragraph.textContent).to.equal('5');
  });
});

/* ── what the server wrote into a textarea stays its defaultValue ────────────────────────────── */
/**
 * The one respect in which a hydrated DOM is deliberately not identical to a client-rendered one.
 *
 * A `<textarea>`'s value **is** its content — `<textarea value="x">` is ignored by every parser —
 * so that is where `@verajs/ssr` puts it, and it is what shows the value to a reader with no
 * JavaScript. Adoption keeps it: it is the only thing holding the value, since adopting no longer
 * writes `.value`, and clearing it would empty the field. It stays as `defaultValue`, which is what
 * `form.reset()` restores — arguably better than a client-only render, which resets to empty.
 */
it('keeps the server’s textarea content as defaultValue', async () => {
  const { shadow } = await hydrateAfter(() => {});
  const area = shadow.querySelector('#area');
  expect(area.value, 'the value adopted').to.equal('server text');
  expect(area.defaultValue, 'and it is what a reset would restore').to.equal('server text');
});

it('and a reader’s edit survives while the default does not move', async () => {
  const { shadow } = await hydrateAfter((root) => (root.querySelector('#area').value = 'typed by hand'));
  const area = shadow.querySelector('#area');
  expect(area.value, 'the reader’s text').to.equal('typed by hand');
  expect(area.defaultValue, 'the server’s, untouched').to.equal('server text');
});

/* ── a live binding still yields to what the reader did ──────────────────────────────────────── */
/**
 * `!name` is authoritative *after* hydration — that is the point of it. During adoption it is not.
 *
 * The click that checked a radio happened before any handler existed to tell the store about it, so
 * re-asserting the server's choice here would throw the interaction away and nothing would ever put
 * it back. Adoption records the value without writing, exactly as it does for `.value`/`.checked`,
 * and the first state-driven render after that applies live semantics normally.
 */
describe('a live binding during hydration', () => {
  const SERVER_RADIOS = `<template shadowrootmode="open"><form>
        <input id="one" type="radio" name="pick" checked />
        <input id="two" type="radio" name="pick" />
      </form></template>`;

  let radioSeq = 0;
  const mountRadios = async (touch) => {
    const tag = `live-probe-${radioSeq++}`;
    const host = document.createElement('div');
    host.setHTMLUnsafe(`<${tag}>${SERVER_RADIOS}</${tag}>`);
    document.body.appendChild(host);
    const element = host.firstElementChild;
    const shadow = element.shadowRoot;
    touch(shadow);

    customElements.define(
      tag,
      class extends HTMLElement {
        connectedCallback() {
          init(this, { mode: 'open' });
          const state = createStore({ picked: 'one' });
          this.state = state;
          render(
            () => html`<form>
        <input id="one" type="radio" name="pick" !checked=${state.picked === 'one'} />
        <input id="two" type="radio" name="pick" !checked=${state.picked === 'two'} />
      </form>`
          );
        }
      }
    );
    await frame();
    await frame();
    return { element, shadow };
  };

  it('leaves a radio the reader clicked before the bundle landed', async () => {
    const { shadow } = await mountRadios((root) => (root.querySelector('#two').checked = true));
    expect(shadow.querySelector('#two').checked, 'the reader’s click was undone').to.equal(true);
    expect(shadow.querySelector('#one').checked).to.equal(false);
  });

  it('and is authoritative from the next state-driven render on', async () => {
    const { element, shadow } = await mountRadios((root) => (root.querySelector('#two').checked = true));
    element.state.picked = 'two';
    await frame();
    element.state.picked = 'one';
    await frame();
    expect(shadow.querySelector('#one').checked, 'live reasserted once the model spoke').to.equal(true);
    expect(shadow.querySelector('#two').checked).to.equal(false);
  });
});
