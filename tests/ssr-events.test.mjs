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
