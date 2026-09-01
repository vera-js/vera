/**
 * What `hold` claims to preserve, in a browser that actually has it.
 *
 * The README's promise is specific: *"What survives is everything no attribute records: what the
 * user typed, a checkbox the user set, a `<details>` left open."* **Not one of those is answerable
 * under a fake DOM** — jsdom has no layout, so
 * no scroll; its `activeElement` tracking is partial; `<details>` has no rendering to speak of. So a
 * suite asserting them elsewhere would be asserting the emulation.
 *
 * Each case toggles a subtree away and back and asks whether the state came with it, and each has a
 * **control that toggles the same subtree without `hold`** — the claim is not that state survives,
 * it is that `hold` is what makes it survive, and a case with no control cannot tell the difference.
 */
import { expect } from '@esm-bundle/chai';
import { html, wire } from '../../packages/core/dist/development/vera.js';
import { renderInto, hold } from '../../packages/renderer/dist/development/vera-renderer.js';

wire({ on: 'render', fn: renderInto, priority: 50 });

const frame = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * Builds a toggler over two templates. `wrap` is either `hold` or a pass-through, so the same case
 * runs both ways — which is the control.
 */
const toggler = (wrap) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const editor = () => html`<div class="editor">
      <input class="text" />
      <textarea class="area"></textarea>
      <input class="check" type="checkbox" />
      <details class="d"><summary>s</summary><p>body</p></details>
      <div class="scroller" style="height: 40px; overflow: auto"><div style="height: 400px"></div></div>
    </div>`;
  const viewer = () => html`<p class="viewer">viewing</p>`;
  const draw = (editing) => html`<div>${wrap(editing ? editor() : viewer())}</div>`;
  return { host, show: (editing) => renderInto(draw(editing), host) };
};

const cases = [
  {
    name: 'what the user typed',
    set: (host) => {
      host.querySelector('.text').value = 'typed by hand';
      host.querySelector('.area').value = 'in the textarea';
    },
    read: (host) => `${host.querySelector('.text').value}|${host.querySelector('.area').value}`,
    fresh: '|',
  },
  {
    name: 'a checkbox the user ticked',
    set: (host) => { host.querySelector('.check').checked = true; },
    read: (host) => String(host.querySelector('.check').checked),
    fresh: 'false',
  },
  {
    name: 'a <details> left open',
    set: (host) => { host.querySelector('.d').open = true; },
    read: (host) => String(host.querySelector('.d').open),
    fresh: 'false',
  },
];

for (const { name, set, read, fresh } of cases) {
  it(`hold preserves ${name}`, async function () {
    const { host, show } = toggler(hold);
    try {
      show(true);
      await frame();
      set(host);
      const before = read(host);
      expect(before, 'the state was never set').to.not.equal(fresh);

      show(false);
      await frame();
      expect(host.textContent, 'the other template should be showing').to.contain('viewing');

      show(true);
      await frame();
      expect(read(host), `${name} did not survive the round trip`).to.equal(before);
    } finally {
      host.remove();
    }
  });

  it(`and without hold, ${name} is lost — which is what makes the claim mean something`, async function () {
    const { host, show } = toggler((value) => value);
    try {
      show(true);
      await frame();
      set(host);
      show(false);
      await frame();
      show(true);
      await frame();
      expect(read(host), `${name} survived without hold, so the case above proves nothing`).to.equal(fresh);
    } finally {
      host.remove();
    }
  });
}

/**
 * Focus is separated out because it is the one that cannot be read from the parked subtree — a
 * detached element is not `document.activeElement` — so the assertion is that it comes *back*, which
 * is the behaviour a person notices.
 */
it('hold brings focus back to the element that had it', async function () {
  const { host, show } = toggler(hold);
  try {
    show(true);
    await frame();
    const input = host.querySelector('.text');
    input.focus();
    expect(document.activeElement, 'the input never took focus').to.equal(input);

    show(false);
    await frame();
    show(true);
    await frame();
    /** The same node, because `hold` parked it rather than rebuilding. */
    expect(host.querySelector('.text'), 'hold rebuilt the input instead of re-adopting it').to.equal(input);
  } finally {
    host.remove();
  }
});

/**
 * The documented boundary: it re-adopts only what it has seen **at that same call site**. Two
 * `hold()` calls in different templates are different templates and must not adopt each other's DOM.
 */
it('two holds in different templates do not adopt each other', async function () {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    const shared = () => html`<input class="shared" />`;
    const drawA = (on) => html`<div class="a">${hold(on ? shared() : html`<i>off</i>`)}</div>`;
    const drawB = (on) => html`<div class="b">${hold(on ? shared() : html`<i>off</i>`)}</div>`;

    renderInto(drawA(true), host);
    await frame();
    const first = host.querySelector('.shared');
    first.value = 'from A';

    renderInto(drawB(true), host);
    await frame();
    const second = host.querySelector('.shared');
    expect(second, 'a different call site adopted the other one\'s DOM').to.not.equal(first);
    expect(second.value, "and carried the other one's state").to.equal('');
  } finally {
    host.remove();
  }
});

/** Anything that is not a template passes straight through, so `hold(cond && tpl)` is safe. */
it('hold passes non-templates through untouched', async function () {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    const draw = (value) => html`<div>${hold(value)}</div>`;
    for (const [value, expected] of [['text', 'text'], [0, '0'], [null, ''], [false, 'false'], [undefined, '']]) {
      renderInto(draw(value), host);
      await frame();
      expect(host.textContent, `hold(${JSON.stringify(value)}) should pass through`).to.equal(expected);
    }
  } finally {
    host.remove();
  }
});

/**
 * **A scroll offset does not survive, and no directive could make it.** The README used to list it
 * among what `hold` preserves; every engine resets `scrollTop` the moment an element leaves the
 * document, so the claim was impossible rather than unimplemented.
 *
 * Asserted rather than deleted, because "this one is different and here is why" is the thing a reader
 * needs — and because if an engine ever *did* start preserving it, the documentation would be
 * understating what works and should be corrected the other way.
 */
it('a scroll offset does not survive, because the engine discards it', async function () {
  const host = document.createElement('div');
  document.body.appendChild(host);
  try {
    /** First: the engine's own behaviour, with no framework involved. */
    const box = document.createElement('div');
    box.style.cssText = 'height: 40px; overflow: auto';
    box.innerHTML = '<div style="height: 400px"></div>';
    host.appendChild(box);
    box.scrollTop = 120;
    expect(box.scrollTop, 'the box never scrolled').to.equal(120);

    const parked = document.createDocumentFragment();
    parked.appendChild(box);
    expect(box.scrollTop, 'a detached element should report no scroll').to.equal(0);
    host.appendChild(box);
    expect(box.scrollTop, 'the engine restored a scroll offset — the README should say so').to.equal(0);

    /** And therefore through `hold`, which parks the nodes exactly that way. */
    const { host: toggled, show } = toggler(hold);
    try {
      show(true);
      await frame();
      toggled.querySelector('.scroller').scrollTop = 120;
      show(false);
      await frame();
      show(true);
      await frame();
      expect(toggled.querySelector('.scroller').scrollTop).to.equal(0);
    } finally {
      toggled.remove();
    }
  } finally {
    host.remove();
  }
});
