/**
 * **`static styles` with nothing adopting them is said once, in development** — the styles README promises it ("Forget
 * the wiring and a component with `static styles` renders unstyled — development says so, once"), and the lean rebuild
 * had dropped it: a depth-50 twin, found by the docs-claims verification pass (2026-10-09). Asked of `@verajs/styles`
 * itself, so wiring another `'init'` module (directives) does not silence it.
 *
 * Each scenario runs in its own process: the warning is once per PAGE, so a second scenario in the same process would
 * hear nothing whatever the code did (measured — a mutant that always warned stayed green that way).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { isProduction, load } from './dist.mjs';

const SCENARIO = process.env.VERA_UNWIRED_STYLES;

if (SCENARIO) {
  const dom = new JSDOM('<!doctype html><body></body>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'Node', 'Element', 'DocumentFragment', 'Text', 'Comment', 'CSSStyleSheet', 'MutationObserver', 'cancelAnimationFrame'])
    globalThis[key] = dom.window[key];
  globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);

  const core = await load('core');
  const { renderer } = await load('renderer');
  /** Another `'init'` module, NOT styles — main's "any init module" check went quiet here. */
  core.wire([renderer, { name: 'other-init', on: 'init', fn: () => {}, priority: 70 }]);
  if (SCENARIO === 'wired') core.wire([(await load('styles')).styles]);

  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  for (const name of ['us-a', 'us-b']) {
    customElements.define(name, class extends HTMLElement {
      static styles = 'p { color: red }';
      connectedCallback() { core.init(this); core.render(() => core.html`<p>x</p>`); }
    });
    dom.window.document.body.append(dom.window.document.createElement(name));
  }
  process.stdout.write(JSON.stringify(said.filter((line) => line.includes('(unwired-styles)'))));
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_UNWIRED_STYLES: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test('static styles with styles NOT wired: said once per page, naming the module — even with another init module wired', { skip: isProduction && 'a development warning' }, () => {
    const said = run('unwired');
    assert.equal(said.length, 1, `once per page, not per class: ${said.join(' | ')}`);
    assert.match(said[0], /^\[vera\] core: <us-a> — declares `static styles`, but nothing is adopting them[\s\S]*wire\(\[styles\]\)[\s\S]*\(unwired-styles\)$/);
  });

  test('with styles wired, nothing is said', () => {
    assert.deepEqual(run('wired'), []);
  });
}
