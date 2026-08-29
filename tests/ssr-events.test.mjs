/**
 * **Event propagation**, against jsdom dispatching the same events.
 *
 * Bubbling was absent and the README said why: this DOM held children as a string, so there was no
 * ancestor chain to walk and an event reached its own target's listeners and stopped. Child nodes
 * are retained now, so the reason expired — a component dispatching a `CustomEvent` for a parent to
 * hear worked in the browser and did nothing on the server, which is the quietest kind of
 * divergence: nothing throws, a handler simply never runs.
 *
 * The listeners moved off the platform's `EventTarget` to make this possible — it cannot be asked to
 * run *only* its capturing listeners — so everything that worked before is re-asserted here too.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import '@verajs/ssr';

const real = new JSDOM('<!doctype html><body></body>').window;

/** The same three-deep tree on both sides. */
const tree = (d) => {
  const host = d.createElement('div');
  const middle = d.createElement('section');
  const leaf = d.createElement('button');
  host.appendChild(middle);
  middle.appendChild(leaf);
  return [host, middle, leaf];
};

const both = (label, run) => {
  const attempt = (d, make) => {
    try {
      return ['ok', String(run(d, make))];
    } catch (error) {
      return ['threw', error.name];
    }
  };
  assert.deepEqual(
    attempt(document, (type, init) => new CustomEvent(type, init)),
    attempt(real.document, (type, init) => new real.CustomEvent(type, init)),
    label
  );
};

test('an event walks the tree', () => {
  both('bubbling reaches every ancestor', (d, event) => {
    const [host, middle, leaf] = tree(d);
    const seen = [];
    host.addEventListener('ping', () => seen.push('host'));
    middle.addEventListener('ping', () => seen.push('middle'));
    leaf.addEventListener('ping', () => seen.push('leaf'));
    leaf.dispatchEvent(event('ping', { bubbles: true }));
    return seen.join(',');
  });

  both('a non-bubbling event stays at its target', (d, event) => {
    const [host, , leaf] = tree(d);
    const seen = [];
    host.addEventListener('ping', () => seen.push('host'));
    leaf.addEventListener('ping', () => seen.push('leaf'));
    leaf.dispatchEvent(event('ping'));
    return seen.join(',') || '(none but leaf)';
  });

  both('capturing runs outermost first', (d, event) => {
    const [host, middle, leaf] = tree(d);
    const seen = [];
    host.addEventListener('ping', () => seen.push('host-capture'), true);
    middle.addEventListener('ping', () => seen.push('middle-capture'), true);
    leaf.addEventListener('ping', () => seen.push('leaf'));
    leaf.dispatchEvent(event('ping', { bubbles: true }));
    return seen.join(',');
  });

  both('target and currentTarget', (d, event) => {
    const [host, , leaf] = tree(d);
    let answer = '';
    host.addEventListener('ping', (e) => {
      answer = `${e.target.localName}/${e.currentTarget.localName}`;
    });
    leaf.dispatchEvent(event('ping', { bubbles: true }));
    return answer;
  });

  both('stopPropagation ends the walk', (d, event) => {
    const [host, middle, leaf] = tree(d);
    const seen = [];
    host.addEventListener('ping', () => seen.push('host'));
    middle.addEventListener('ping', (e) => {
      seen.push('middle');
      e.stopPropagation();
    });
    leaf.addEventListener('ping', () => seen.push('leaf'));
    leaf.dispatchEvent(event('ping', { bubbles: true }));
    return seen.join(',');
  });

  both('stopImmediatePropagation ends this node too', (d, event) => {
    const [, , leaf] = tree(d);
    const seen = [];
    leaf.addEventListener('ping', (e) => {
      seen.push('first');
      e.stopImmediatePropagation();
    });
    leaf.addEventListener('ping', () => seen.push('second'));
    leaf.dispatchEvent(event('ping', { bubbles: true }));
    return seen.join(',');
  });
});

/** Everything the shim already promised, re-asserted now that the listeners live elsewhere. */
test('the listener contract is unchanged', () => {
  both('once fires once', (d, event) => {
    const [host] = tree(d);
    let count = 0;
    host.addEventListener('x', () => count++, { once: true });
    host.dispatchEvent(event('x'));
    host.dispatchEvent(event('x'));
    return count;
  });
  both('a handleEvent object is a listener', (d, event) => {
    const [host] = tree(d);
    let ran = false;
    host.addEventListener('x', { handleEvent: () => (ran = true) });
    host.dispatchEvent(event('x'));
    return ran;
  });
  both('the same listener twice registers once', (d, event) => {
    const [host] = tree(d);
    let count = 0;
    const listener = () => count++;
    host.addEventListener('x', listener);
    host.addEventListener('x', listener);
    host.dispatchEvent(event('x'));
    return count;
  });
  both('removeEventListener removes it', (d, event) => {
    const [host] = tree(d);
    let count = 0;
    const listener = () => count++;
    host.addEventListener('x', listener);
    host.removeEventListener('x', listener);
    host.dispatchEvent(event('x'));
    return count;
  });
  both('preventDefault reaches the dispatcher', (d, event) => {
    const [host] = tree(d);
    host.addEventListener('x', (e) => e.preventDefault());
    return host.dispatchEvent(event('x', { cancelable: true }));
  });
  both('an uncancelable event cannot be prevented', (d, event) => {
    const [host] = tree(d);
    host.addEventListener('x', (e) => e.preventDefault());
    return host.dispatchEvent(event('x'));
  });
  both('dispatching something that is not an event', (d) => {
    const [host] = tree(d);
    return host.dispatchEvent(/** @type {any} */ ({}));
  });
});

/**
 * A shadow boundary is crossed only by a `composed` event, which is what keeps a component's
 * internals private — and is the rule a server has to honour for the same markup to behave the same.
 */
test('composed decides whether a shadow boundary is crossed', () => {
  both('a composed event reaches the host', (d, event) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inside = d.createElement('button');
    root.appendChild(inside);
    let reached = false;
    host.addEventListener('ping', () => (reached = true));
    inside.dispatchEvent(event('ping', { bubbles: true, composed: true }));
    return reached;
  });
  both('an uncomposed one does not', (d, event) => {
    const host = d.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const inside = d.createElement('button');
    root.appendChild(inside);
    let reached = false;
    host.addEventListener('ping', () => (reached = true));
    inside.dispatchEvent(event('ping', { bubbles: true, composed: false }));
    return reached;
  });
});

/** A listener that throws must not take the dispatch down, exactly as in a browser. */
test('a listener that throws does not stop the others', () => {
  const [host, , leaf] = tree(document);
  const seen = [];
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(' '));
  try {
    leaf.addEventListener('ping', () => {
      throw new Error('listener exploded');
    });
    leaf.addEventListener('ping', () => seen.push('second'));
    host.addEventListener('ping', () => seen.push('host'));
    const answer = leaf.dispatchEvent(new CustomEvent('ping', { bubbles: true }));
    assert.deepEqual(seen, ['second', 'host'], 'the rest still ran');
    assert.equal(answer, true, 'and the dispatch reported success');
  } finally {
    console.error = original;
  }
  assert.equal(errors.length, 1, 'the failure was reported');
  assert.match(errors[0], /^\[vera\]/, 'with the framework prefix');
});

/**
 * **`eventPhase` reported `NONE` for the whole dispatch**, where every engine reports 1, 2 and 3 —
 * and the four constants a browser puts on `Event.prototype` were missing, because Node puts them
 * on `Event` alone.
 *
 * The two compound into the failure that is worth the test. `event.eventPhase === event.AT_TARGET`
 * is the ordinary way a component asks "was this mine, or a descendant's?", and against `undefined`
 * it is `false` in every phase — so the branch is not taken wrongly, it is never taken at all. The
 * server and the client then disagree about an event both of them dispatched, with nothing to show
 * for it until something else fails.
 *
 * Measured on Chromium, Firefox and WebKit before it was called a defect: all three report `1,2,3`
 * and all three carry `NONE`, `CAPTURING_PHASE`, `AT_TARGET` and `BUBBLING_PHASE` on the prototype.
 */
test('eventPhase says which phase is running, as the engines do', () => {
  const seen = { vera: [], real: [] };
  for (const [key, d] of [['vera', globalThis.document], ['real', real.document]]) {
    const [host, middle, target] = tree(d);
    host.addEventListener('x', (e) => seen[key].push(e.eventPhase), true);
    target.addEventListener('x', (e) => seen[key].push(e.eventPhase));
    middle.addEventListener('x', (e) => seen[key].push(e.eventPhase));
    target.dispatchEvent(new (key === 'vera' ? Event : real.Event)('x', { bubbles: true }));
  }
  assert.deepEqual(seen.vera, [1, 2, 3], 'capture, target, bubble');
  assert.deepEqual(seen.vera, seen.real, 'and the same as a real dispatch');
});

test('a finished event is back to NONE', () => {
  const [, , target] = tree(globalThis.document);
  const event = new Event('x');
  assert.equal(event.eventPhase, 0, 'before dispatch');
  target.addEventListener('x', () => {});
  target.dispatchEvent(event);
  assert.equal(event.eventPhase, 0, 'after dispatch');
});

test('the phase constants are on the event, not only on the interface', () => {
  const event = new Event('x');
  assert.deepEqual(
    [event.NONE, event.CAPTURING_PHASE, event.AT_TARGET, event.BUBBLING_PHASE],
    [0, 1, 2, 3],
    'a browser answers these on the instance; Node has them on Event alone'
  );
  /** Which is what makes the idiom work at all. */
  const [host, , target] = tree(globalThis.document);
  const phases = [];
  host.addEventListener('x', (e) => phases.push(e.eventPhase === e.AT_TARGET));
  target.addEventListener('x', (e) => phases.push(e.eventPhase === e.AT_TARGET));
  target.dispatchEvent(new Event('x', { bubbles: true }));
  assert.deepEqual(phases, [true, false], 'true at the target, false while bubbling');
});

/**
 * The guard here checked `typeof event.type === 'string'`, which `{ type: 'click' }` satisfies. So
 * the server accepted a dispatch every engine refuses with a `TypeError`, and the mistake that
 * produced it travelled to the client before failing. Where the platform throws, this throws.
 */
test('dispatchEvent takes an Event, not something shaped like one', () => {
  const [, , target] = tree(globalThis.document);
  for (const wrong of [{ type: 'click' }, 'click', null, undefined, 42, { type: 'x', bubbles: true }]) {
    assert.throws(
      () => target.dispatchEvent(wrong),
      TypeError,
      `dispatching ${JSON.stringify(wrong)} was accepted`
    );
  }
  /** And the real thing still works, including a subclass. */
  let ran = 0;
  target.addEventListener('x', () => ran++);
  target.dispatchEvent(new Event('x'));
  target.dispatchEvent(new CustomEvent('x', { detail: 1 }));
  assert.equal(ran, 2);
});
