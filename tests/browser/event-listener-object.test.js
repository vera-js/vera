/**
 * The listener shapes an engine actually accepts, and whether `@event` accepts the same ones.
 *
 * `addEventListener` takes **two** shapes — a function, and an object with a `handleEvent` method —
 * and which shapes are legal is the platform's decision, not jsdom's. The node suite
 * (`tests/renderer-event-bindings.test.mjs`) is the regression net; this is what makes the claim it
 * rests on true, and it asserts the engine's own behaviour first so a failure says which half moved.
 *
 * The renderer used to call `.call()` unconditionally, so the object form bound without complaint
 * and then threw `this._handler.call is not a function` on every dispatch — invisible until someone
 * clicked.
 */
import { expect } from '@esm-bundle/chai';
import { renderInto } from '../../packages/renderer/dist/development/vera-renderer.js';
import { html } from '../../packages/core/dist/development/vera.js';

const into = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
};

it('this engine accepts an object listener', () => {
  let fired = 0;
  const button = document.createElement('button');
  button.addEventListener('click', { handleEvent() { fired++; } });
  button.click();
  expect(fired, 'addEventListener({ handleEvent }) is not honoured by this engine').to.equal(1);
});

it('and so does an @event binding', () => {
  const container = into();
  let fired = 0;
  let self;
  renderInto(html`<button @click=${{ handleEvent(event) { fired++; self = event.currentTarget; } }}>x</button>`, container);
  const button = container.querySelector('button');
  button.click();
  expect(fired, 'the object bound but never listened').to.equal(1);
  expect(self, 'the event should still come from the bound element').to.equal(button);
});

it('a function binding still receives the element as `this`', () => {
  const container = into();
  let receivedElement = false;
  /** Compared in place rather than captured — aliasing `this` is what `no-this-alias` refuses. */
  renderInto(
    html`<button @click=${function () { receivedElement = this === container.querySelector('button'); }}>x</button>`,
    container
  );
  container.querySelector('button').click();
  expect(receivedElement, '`this` was not the bound element').to.equal(true);
});

/**
 * A real click, not a synthetic dispatch: an exception raised inside a listener is reported to
 * `window.onerror` rather than propagating to the caller, so "it did not throw" has to be observed
 * from there or it is not observed at all.
 */
it('a value that cannot listen raises nothing when clicked', async () => {
  const raised = [];
  const onError = (event) => raised.push(event.message ?? String(event.reason));
  window.addEventListener('error', onError);
  try {
    for (const value of ['alert(1)', 42, true, {}]) {
      const container = into();
      renderInto(html`<button @click=${value}>x</button>`, container);
      container.querySelector('button').click();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    window.removeEventListener('error', onError);
  }
  expect(raised, 'a non-listener value threw on dispatch').to.deep.equal([]);
});
