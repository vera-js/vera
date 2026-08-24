/**
 * **The same interactions, driven in both live modes, compared after every step.**
 *
 * `kitchen-parity` proves the three renderings *start* identical. This proves the two live ones
 * stay identical once someone uses them — which is the half a hydrated page fails silently. Adopted
 * nodes carry the renderer's state; if any of it is wrong, the first update is where it shows, not
 * the first paint.
 *
 * Every step also asserts **node identity** where identity is the claim: a keyed reorder must move
 * the nodes the server built, not rebuild them, and `hold()` must keep the DOM of a toggled-away
 * subtree alive so what the user typed survives.
 */
import { expect } from '@esm-bundle/chai';
import { canonical } from '../canonical.mjs';

const load = (path) =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe');
    /**
     * On-screen, deliberately. Firefox and WebKit throttle `requestAnimationFrame` in an iframe
     * that is not being displayed — and the render scheduler *is* `requestAnimationFrame`, so an
     * offscreen frame simply stops updating and every assertion after the first times out. Small
     * and behind the page rather than hidden: `display:none` and `visibility:hidden` throttle too.
     */
    frame.style.cssText =
      'position:fixed;top:0;left:0;width:320px;height:240px;opacity:0.02;border:0;pointer-events:none;z-index:-1';
    frame.src = path;
    frame.addEventListener('load', () => resolve(frame));
    document.body.appendChild(frame);
  });

const until = async (predicate, what, timeout = 20000) => {
  const started = performance.now();
  for (;;) {
    let value;
    try {
      value = predicate();
    } catch {
      value = false;
    }
    if (value) return value;
    if (performance.now() - started > timeout) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

/** Two frames plus a drained microtask queue: renders, layout effects and effects have all run. */
const settle = async (frame) => {
  const view = frame.contentWindow;
  for (let i = 0; i < 3; i++) await new Promise((r) => view.requestAnimationFrame(() => r()));
  await Promise.resolve();
};

/**
 * The rendered DOM, minus anything marked `data-diagnostic`.
 *
 * The shell's banner reports which of the five modes is running — its whole job is to differ
 * between them — so comparing it would fail every comparison it appears in. It is environment
 * reporting, not application content, and is excluded for the same reason `<style vera-styles>` is.
 */
const shape = (root) => canonical(root).replace(/<p [^>]*data-diagnostic[^>]*>[\s\S]*?<\/p>/g, '');

const modes = {};

/** A component inside the shell, by tag. */
const part = (mode, tag) => modes[mode].shell.shadowRoot.querySelector(tag);
const inside = (mode, tag, selector) => part(mode, tag).shadowRoot.querySelector(selector);

/** Two live documents, each booting a whole application — well past mocha's 5 s default. */
before(async function loadBothLiveModes() {
  this.timeout(30000);
  for (const [mode, path] of [
    ['csr', '/tests/browser/fixtures/kitchen-csr.html'],
    ['hydrate', '/tests/browser/fixtures/kitchen-hydrate.html'],
  ]) {
    const frame = await load(path);
    await until(() => frame.contentDocument.documentElement.dataset.sinkMode === mode, `${mode} to boot`);
    const shell = await until(
      () => frame.contentDocument.querySelector('sink-shell')?.shadowRoot?.querySelector('#shell') &&
        frame.contentDocument.querySelector('sink-shell'),
      `${mode} shell`
    );
    await until(() => shell.shadowRoot.querySelector('sink-form')?.shadowRoot, `${mode} components`);
    /**
     * Including the **lazily loaded** one, or the two modes are compared at different moments: the
     * autoloader fetches `<sink-lazy>` over the network, so one frame can have it and the other not
     * yet. That is a flake in the harness rather than a difference in Vera, and a flaky test is
     * worse than no test.
     */
    await until(
      () => shell.shadowRoot.querySelector('sink-lazy')?.shadowRoot?.querySelector('#lazy'),
      `${mode}: <sink-lazy> to autoload`
    );
    await settle(frame);
    modes[mode] = { frame, shell };
  }
});

/** Runs `step` in both modes and asserts the two DOMs still agree afterwards. */
const inBoth = async (step) => {
  for (const mode of ['csr', 'hydrate']) {
    await step(mode);
    await settle(modes[mode].frame);
  }
  const of = (mode) => shape(modes[mode].shell.shadowRoot);
  expect(of('hydrate'), 'the two live modes diverged after an interaction').to.equal(of('csr'));
};

describe('the two live modes behave identically', () => {
  /** Three applications in three documents; mocha's 5 s default is for unit tests. */
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it('start from the same DOM', () => {
    expect(shape(modes.hydrate.shell.shadowRoot)).to.equal(shape(modes.csr.shell.shadowRoot));
  });

  it('a lazily loaded component arrives in both', async () => {
    for (const mode of ['csr', 'hydrate'])
      await until(() => inside(mode, 'sink-lazy', '#lazy'), `${mode}: <sink-lazy> to autoload`);
    expect(inside('hydrate', 'sink-lazy', '#lazy').textContent).to.equal('loaded on demand');
  });

  it('state written after the first render re-renders', async () => {
    await inBoth((mode) => part(mode, 'sink-effects').bump(3));
    expect(inside('hydrate', 'sink-effects', '#n').textContent).to.equal('3');
  });

  it('a coalesced effect runs once per frame and a sync effect once per write', async () => {
    /**
     * Three writes in **one turn**. The sync effect sees each; the coalesced ones see one batch.
     *
     * Only the sync side was asserted here before, so the panel that reports all three could — and
     * did — mislead a reader about the other two while this stayed green. The counts are read from
     * the component rather than the markup, because `useEffect` runs *after* the render that shows
     * it and would otherwise be one behind.
     */
    const counts = () => ({ ...part('hydrate', 'sink-effects').counts });
    const before = counts();
    await inBoth((mode) => part(mode, 'sink-effects').bump(3));
    const after = counts();

    expect(after.sync - before.sync, 'a sync effect must observe every intermediate write').to.equal(3);
    expect(after.coalesced - before.coalesced, 'useEffect must coalesce three writes into one run').to.equal(1);
    expect(after.layout - before.layout, 'useLayoutEffect must coalesce them too').to.equal(1);

    /** And three writes in three separate turns are three of everything — the same rule, not another. */
    const beforeSeparate = counts();
    for (let i = 0; i < 3; i++) await inBoth((mode) => part(mode, 'sink-effects').bump(1));
    const afterSeparate = counts();
    expect(afterSeparate.sync - beforeSeparate.sync).to.equal(3);
    expect(afterSeparate.coalesced - beforeSeparate.coalesced, 'separate turns do not batch').to.equal(3);
    expect(afterSeparate.layout - beforeSeparate.layout, 'separate turns do not batch').to.equal(3);
  });

  it('a keyed reorder moves nodes instead of rebuilding them', async () => {
    const kept = {};
    for (const mode of ['csr', 'hydrate']) kept[mode] = inside(mode, 'sink-list', '#keyed li[data-id="a"]');

    await inBoth((mode) => part(mode, 'sink-list').reverse());

    for (const mode of ['csr', 'hydrate']) {
      const list = part(mode, 'sink-list').shadowRoot;
      expect([...list.querySelectorAll('#keyed li')].map((li) => li.dataset.id)).to.deep.equal(['c', 'b', 'a']);
      expect(
        list.querySelector('#keyed li[data-id="a"]'),
        `${mode}: the keyed row was rebuilt rather than moved`
      ).to.equal(kept[mode]);
    }
  });

  it('removing a row updates the count and reveals the empty state', async () => {
    await inBoth((mode) => {
      const list = part(mode, 'sink-list');
      list.removeFirst();
      list.removeFirst();
      list.removeFirst();
    });
    expect(inside('hydrate', 'sink-list', '#count').textContent).to.equal('0');
    expect(inside('hydrate', 'sink-list', '#empty').hasAttribute('hidden')).to.equal(false);
  });

  it('a reactive Map re-renders its subscribers', async () => {
    await inBoth((mode) => part(mode, 'sink-collections').state.users.set('u3', 'Katherine'));
    expect([...part('hydrate', 'sink-collections').shadowRoot.querySelectorAll('#users li')].map((li) => li.textContent))
      .to.deep.equal(['Ada', 'Grace', 'Katherine']);
    expect(inside('hydrate', 'sink-collections', '#userCount').textContent).to.equal('3');
  });

  it('a reactive Set and a WeakMap do too', async () => {
    await inBoth((mode) => {
      const component = part(mode, 'sink-collections');
      component.state.tags.add('gamma');
      component.state.meta.set(component.weakKey, 'changed');
    });
    expect(inside('hydrate', 'sink-collections', '#tagCount').textContent).to.equal('3');
    expect(inside('hydrate', 'sink-collections', '#weak').textContent).to.equal('changed');
  });

  it('hold() keeps what the user typed across a toggle', async () => {
    /** Type into the editor, toggle away, toggle back: the text is still there and so is the node. */
    await inBoth((mode) => part(mode, 'sink-form').toggle());
    const typed = {};
    for (const mode of ['csr', 'hydrate']) {
      const editor = inside(mode, 'sink-form', '#editor');
      expect(editor, `${mode}: the editor did not appear`).to.exist;
      editor.value = 'typed by the user';
      typed[mode] = editor;
    }
    await inBoth((mode) => part(mode, 'sink-form').toggle());
    await inBoth((mode) => part(mode, 'sink-form').toggle());
    for (const mode of ['csr', 'hydrate']) {
      const editor = inside(mode, 'sink-form', '#editor');
      expect(editor, `${mode}: hold() rebuilt the subtree`).to.equal(typed[mode]);
      expect(editor.value, `${mode}: what the user typed was lost`).to.equal('typed by the user');
    }
  });

  it('an observed attribute reaches the component after hydration', async () => {
    await inBoth((mode) => part(mode, 'sink-form').setAttribute('label', 'Changed'));
    expect(inside('hydrate', 'sink-form', '#log').textContent).to.contain('label: Name → Changed');
  });

  it('a custom property re-tints a component styled by a constructed sheet', async () => {
    await inBoth((mode) => (part(mode, 'sink-styled').state.accent = 'crimson'));
    const styled = inside('hydrate', 'sink-styled', '#styled');
    expect(styled.getAttribute('style')).to.contain('crimson');
    const badge = part('hydrate', 'sink-styled').shadowRoot.querySelector('.badge');
    expect(getComputedStyle(badge).color, 'the adopted sheet is not applying').to.equal('rgb(220, 20, 60)');
  });
});
