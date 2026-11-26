/**
 * **<vera-checkbox> and <vera-switch> in jsdom, through the built bundle, both builds**: the marks on the author's input
 * and their release, the switch's semantics with and without the platform's `switch`, mixed kept in step with the
 * input's property through a click and a canceled click, and the development warnings. jsdom is the regression net;
 * the engines' own answers (the native switch, paint, the accessibility tree) are the browser rows'.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isProduction, load } from './dist.mjs';

const SCENARIO = process.env.VERA_CHECKBOX_SCENARIO;

if (SCENARIO) {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/', pretendToBeVisual: true });
  for (const key of ['window', 'document', 'HTMLElement', 'customElements', 'CSSStyleSheet', 'Node', 'Element', 'DocumentFragment', 'requestAnimationFrame', 'cancelAnimationFrame', 'Event', 'CustomEvent', 'MutationObserver']) globalThis[key] = dom.window[key];
  /** The native switch, faked present: the IDL attribute the element detects (WebKit's), reflecting the content attribute. */
  if (SCENARIO === 'native-switch')
    Object.defineProperty(dom.window.HTMLInputElement.prototype, 'switch', {
      configurable: true,
      get() {
        return this.hasAttribute('switch');
      },
    });
  const said = [];
  console.warn = (...args) => said.push(String(args[0]));
  console.error = (...args) => said.push(String(args[0]));
  const { flush, wire } = await load('core');
  wire([(await load('renderer')).renderer]);
  await load('vera-components/checkbox');
  const out = { said };
  const settle = async () => {
    flush();
    await Promise.resolve();
    flush();
    await new Promise((resolve) => setTimeout(resolve, 10));
    flush();
  };
  const attrs = (el) => Object.fromEntries([...el.attributes].map((a) => [a.name, a.value]));

  if (SCENARIO === 'marks') {
    document.body.innerHTML =
      '<vera-checkbox id="a"><label><input type="checkbox"> A</label></vera-checkbox>' +
      '<vera-checkbox id="b" data-vera-look="none"><label><input type="checkbox"> B</label></vera-checkbox>' +
      '<vera-checkbox id="c" data-vera-look="none"><label><input type="checkbox" data-vera-look="mine"> C</label></vera-checkbox>';
    await settle();
    const [a, b, c] = document.querySelectorAll('input');
    out.served = [attrs(a), attrs(b), attrs(c)];
    /** The host's opt-out is read when the input is served: written on the host later, it does not reach the input. */
    document.getElementById('a').setAttribute('data-vera-look', 'none');
    await settle();
    out.later = attrs(a);
    /** Moved out of its host: the input goes back to what the author wrote. */
    document.body.append(b);
    await settle();
    out.released = attrs(b);
    /** A new input written into a host that lost its own: served. */
    const fresh = document.createElement('input');
    fresh.type = 'checkbox';
    fresh.setAttribute('aria-label', 'Fresh');
    document.getElementById('b').querySelector('label').append(fresh);
    await settle();
    out.fresh = attrs(fresh);
  } else if (SCENARIO === 'switch' || SCENARIO === 'native-switch') {
    document.body.innerHTML =
      '<vera-switch><label><input type="checkbox"> A</label></vera-switch>' +
      '<vera-switch><label><input type="checkbox" role="checkbox"> Theirs</label></vera-switch>';
    await settle();
    const [a, theirs] = document.querySelectorAll('input');
    out.served = [attrs(a), attrs(theirs)];
    a.closest('vera-switch').remove();
    await settle();
    out.released = attrs(a);
  } else if (SCENARIO === 'mixed') {
    document.body.innerHTML = '<vera-checkbox indeterminate><label><input type="checkbox"> All</label></vera-checkbox>';
    await settle();
    const host = document.querySelector('vera-checkbox');
    const input = host.querySelector('input');
    const events = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    out.set = { property: input.indeterminate, attribute: host.hasAttribute('indeterminate') };
    host.removeAttribute('indeterminate');
    await settle();
    out.unset = { property: input.indeterminate };
    host.setAttribute('indeterminate', '');
    await settle();
    /** Canceled by a listener added AFTER ours, on the document: the platform restores both, and so does the host. */
    const cancel = (event) => event.preventDefault();
    document.addEventListener('click', cancel);
    input.click();
    await settle();
    out.canceled = { checked: input.checked, property: input.indeterminate, attribute: host.hasAttribute('indeterminate'), events: [...events] };
    document.removeEventListener('click', cancel);
    input.click();
    await settle();
    out.clicked = { checked: input.checked, property: input.indeterminate, attribute: host.hasAttribute('indeterminate'), events: [...events] };
    /** Mixed again over a checked box, then a click: unchecked, no longer mixed. */
    host.setAttribute('indeterminate', '');
    await settle();
    input.click();
    await settle();
    out.again = { checked: input.checked, property: input.indeterminate, attribute: host.hasAttribute('indeterminate') };
    /** Mixed, then swapped for a new input in the same task (a framework re-render): the old one keeps no dash, the new one takes it. */
    host.setAttribute('indeterminate', '');
    await settle();
    const before = input.indeterminate;
    const fresh = document.createElement('input');
    fresh.type = 'checkbox';
    input.replaceWith(fresh);
    await settle();
    out.moved = { before, after: input.indeterminate, fresh: fresh.indeterminate };
  } else if (SCENARIO === 'mixed-timing') {
    document.body.innerHTML = '<vera-checkbox><label><input type="checkbox"> All</label></vera-checkbox>';
    await settle();
    const host = document.querySelector('vera-checkbox');
    const input = host.querySelector('input');
    /** Read in the same task as the write and its flush(): no microtask, no timer between. */
    host.setAttribute('indeterminate', '');
    flush();
    out.set = input.indeterminate;
    await Promise.resolve();
    out.setLater = input.indeterminate;
    host.removeAttribute('indeterminate');
    flush();
    out.unset = input.indeterminate;
    await Promise.resolve();
    out.unsetLater = input.indeterminate;
  } else if (SCENARIO === 'warnings') {
    document.body.innerHTML =
      '<vera-checkbox id="none"><label>No input</label></vera-checkbox>' +
      '<vera-checkbox id="empty"><label><input type="checkbox"></label></vera-checkbox>' +
      '<vera-switch id="hidden"><label><input type="checkbox"><span hidden>Hidden text</span></label></vera-switch>' +
      '<vera-checkbox><label><input type="checkbox"> Wrapped</label></vera-checkbox>' +
      '<vera-checkbox><input type="checkbox" id="f"><label for="f">For</label></vera-checkbox>' +
      '<vera-checkbox><input type="checkbox" aria-label="Aria"></vera-checkbox>' +
      '<span id="ext">External</span><vera-switch><input type="checkbox" aria-labelledby="ext"></vera-switch>' +
      '<vera-checkbox><label><input type="checkbox"><img alt="Image"></label></vera-checkbox>';
    await settle();
  }
  process.stdout.write(JSON.stringify(out));
} else {
  const run = (scenario) => {
    const result = spawnSync(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url)], {
      encoding: 'utf8',
      env: { ...process.env, VERA_CHECKBOX_SCENARIO: scenario },
    });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };

  test("the input carries the mark while served, the host's look opt-out reaches it unless it has its own, and it is released to what the author wrote", () => {
    const { served, later, released, fresh, said } = run('marks');
    assert.deepEqual(served[0], { type: 'checkbox', 'data-vera-checkbox': '' });
    assert.deepEqual(served[1], { type: 'checkbox', 'data-vera-checkbox': '', 'data-vera-look': 'none' });
    assert.deepEqual(served[2], { type: 'checkbox', 'data-vera-look': 'mine', 'data-vera-checkbox': '' }, "the author's own opt-out stays");
    assert.deepEqual(later, { type: 'checkbox', 'data-vera-checkbox': '' }, "the host's opt-out is read when the input is served, so one written later does not reach it (set it on the input instead)");
    assert.deepEqual(released, { type: 'checkbox' }, 'moved out of its host, the input is as the author wrote it');
    assert.deepEqual(fresh, { type: 'checkbox', 'aria-label': 'Fresh', 'data-vera-checkbox': '', 'data-vera-look': 'none' }, 'a new input is served');
    /** The host left empty for a task (the input moved out, the new one written a task later) says so, once. */
    assert.deepEqual(
      said.map((line) => /\(([a-z-]+)\)'?$/.exec(line.trim())?.[1] ?? line),
      isProduction ? [] : ['checkbox-no-control'],
    );
  });

  test('a switch takes role="switch" where the engine has no native switch, keeps a role the author wrote, and gives it back', () => {
    const { served, released, said } = run('switch');
    assert.deepEqual(served[0], { type: 'checkbox', 'data-vera-switch': '', role: 'switch' });
    assert.deepEqual(served[1], { type: 'checkbox', role: 'checkbox', 'data-vera-switch': '' }, "the author's role is theirs");
    assert.deepEqual(released, { type: 'checkbox' });
    assert.deepEqual(said, []);
  });

  test('where the engine has the native switch, a switch takes the switch attribute and no role: exactly one of the two', () => {
    const { served, released, said } = run('native-switch');
    assert.deepEqual(served[0], { type: 'checkbox', 'data-vera-switch': '', switch: '' });
    assert.equal(served[0].role, undefined, 'no role beside the native switch');
    assert.deepEqual(released, { type: 'checkbox' });
    assert.deepEqual(said, []);
  });

  test('mixed follows the attribute by flush(): written, then flush(), and the input is mixed in the same task, both ways', () => {
    const { set, setLater, unset, unsetLater, said } = run('mixed-timing');
    assert.deepEqual({ setLater, unsetLater }, { setLater: true, unsetLater: false }, 'and a microtask later, both ways');
    assert.equal(set, true, 'set, then flush(): the input is mixed before any microtask');
    assert.equal(unset, false, 'removed, then flush(): no longer mixed before any microtask');
    assert.deepEqual(said, []);
  });

  test('mixed: the attribute sets the property; a click clears both with one input and one change; a click a later listener cancels keeps both', () => {
    const { set, unset, canceled, clicked, again, moved, said } = run('mixed');
    assert.deepEqual(set, { property: true, attribute: true });
    assert.deepEqual(unset, { property: false });
    assert.deepEqual(canceled, { checked: false, property: true, attribute: true, events: [] }, 'the canceled click changed nothing');
    assert.deepEqual(clicked, { checked: true, property: false, attribute: false, events: ['input', 'change'] });
    assert.deepEqual(again, { checked: false, property: false, attribute: false }, 'mixed over a checked box: the click unchecks it');
    assert.deepEqual(moved, { before: true, after: false, fresh: true }, 'an input swapped out of a mixed host keeps no dash; the new one is mixed');
    assert.deepEqual(said, []);
  });

  test('development warns for a host with no input and for an input with no name, and names every labeled one', () => {
    const { said } = run('warnings');
    if (isProduction) return assert.deepEqual(said, []);
    const codes = said.map((line) => /\(([a-z-]+)\)'?$/.exec(line.trim())?.[1] ?? line);
    assert.deepEqual(codes, ['checkbox-no-control', 'checkbox-no-name', 'checkbox-no-name'], said.join(' | '));
    for (const line of said) assert.match(line, /^\[vera\] /);
    assert.ok(said[0].includes('<vera-checkbox>') && said[2].includes('<vera-switch>'), 'each names its own tag');
  });
}
