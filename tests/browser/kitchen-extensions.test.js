/**
 * **Pass 1 probes.** The extension points, the schedulers, and the module surfaces the kitchen sink
 * wires but nothing had yet asserted.
 *
 * `insert` is the product — `docs/CODE-PRINCIPLES.md` #6 says so — and a registration that silently
 * lands in a map nobody reads is the failure mode this framework has already shipped once. So these
 * assert the chains *ran*, on counters the inserts themselves keep, rather than that registering
 * returned without throwing.
 */
import { expect } from '@esm-bundle/chai';

const load = (path) =>
  new Promise((resolve) => {
    const frame = document.createElement('iframe');
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

const settle = async (frame) => {
  for (let i = 0; i < 4; i++) await new Promise((r) => frame.contentWindow.requestAnimationFrame(() => r()));
  await Promise.resolve();
};

let frame;
let shell;
let observed;
let SUPPRESS;

before(async function bootOneLiveMode() {
  this.timeout(30000);
  frame = await load('/tests/browser/fixtures/kitchen-csr.html');
  await until(() => frame.contentDocument.documentElement.dataset.sinkMode === 'csr', 'the app to boot');
  shell = await until(
    () =>
      frame.contentDocument.querySelector('sink-shell')?.shadowRoot?.querySelector('#shell') &&
      frame.contentDocument.querySelector('sink-shell'),
    'the shell'
  );
  await settle(frame);
  const module = await frame.contentWindow.eval(
    "import('/examples/kitchen-sink/components/sink-inserts.js')"
  );
  observed = module.observed;
  SUPPRESS = module.SUPPRESS;
});

describe('the extension points actually run', () => {
  beforeEach(function raiseTheTimeout() {
    this.timeout(30000);
  });

  it("a 'proxy-handler' insert sees property reads", () => {
    expect(observed.reads, 'nothing reached the proxy-handler chain').to.be.greaterThan(0);
  });

  it("a 'set-handler' insert sees property writes", async () => {
    const before = observed.writes;
    shell.shadowRoot.querySelector('sink-effects').bump(1);
    await settle(frame);
    expect(observed.writes, 'nothing reached the set-handler chain').to.be.greaterThan(before);
  });

  it("a 'set-handler' returning false suppresses the write", async () => {
    const styled = shell.shadowRoot.querySelector('sink-styled');
    const before = observed.suppressed;
    styled.state.accent = SUPPRESS;
    await settle(frame);
    expect(observed.suppressed, 'the suppressing branch never ran').to.equal(before + 1);
    expect(
      styled.shadowRoot.querySelector('#styled').getAttribute('style'),
      'a suppressed write still re-rendered'
    ).to.not.contain(SUPPRESS);
  });

  it("an 'error' insert receives what a hook threw", async () => {
    const before = observed.errors.length;
    const list = shell.shadowRoot.querySelector('sink-list');
    /** A row whose label getter throws: the failure happens inside the render hook. */
    list.rows.value = [
      {
        id: 'bad',
        get label() {
          throw new Error('kitchen sink: deliberate render failure');
        },
      },
    ];
    await settle(frame);
    expect(observed.errors.length, 'the error chain never ran').to.be.greaterThan(before);
    expect(observed.errors.join('|')).to.contain('deliberate render failure');
    /** And the page is still alive: core isolates a hook error rather than rethrowing. */
    list.rows.value = [{ id: 'a', label: 'alpha' }];
    await settle(frame);
    expect(list.shadowRoot.querySelector('#keyed li').textContent).to.equal('alpha');
  });
});
