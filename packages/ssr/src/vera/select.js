/**
 * A selector matcher for the node view.
 *
 * **It answers, or it refuses — it never guesses.** Every query used to return `null` or an empty
 * list whatever was asked, so `this.matches('[data-open]')` was `false` on an element that plainly
 * had the attribute and a component branched the wrong way with nothing said. Replacing that with a
 * matcher that silently mishandles `:hover` would be the same defect in a new place, so anything
 * outside the grammar below throws and names itself.
 *
 * The grammar is what a server can answer honestly: structure and attributes. Everything it refuses
 * needs something a server does not have — user state (`:hover`, `:focus`), layout (`:visible`), or
 * a document (`:root`, `:target`).
 */

/** `[name op "value" i]` — every attribute operator the platform defines. */
const ATTRIBUTE = /^\[\s*([^\s\]~^$*|=]+)\s*(?:([~^$*|]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*))\s*)?(?:([iIsS])\s*)?\]/;
const NAME = /^[*]|^[a-zA-Z][\w-]*/;
const CLASS = /^\.([\w-]+)/;
const ID = /^#([\w-]+)/;
const NOT = /^:not\(/i;

/** @param {string} selector */
const refuse = (selector, why) => {
  throw new Error(
    `ssr: this DOM cannot answer the selector ${JSON.stringify(selector)} — ${why}. It matches on ` +
      `structure and attributes only. Rather than return a wrong answer it says so.`
  );
};

/**
 * One compound selector — `div.a#b[c=d]:not(.e)` — as a list of tests.
 * Returns the parsed compound and how much of the string it consumed.
 */
const parseCompound = (source, selector) => {
  const tests = [];
  let rest = source;
  let consumed = 0;
  /** Every branch below assigns this before it is read; `refuse` throws rather than falling through. */
  let /** @type {any} */ match;
  for (;;) {
    if (rest === '' || /^[\s,>+~)]/.test(rest)) break;
    if ((match = NAME.exec(rest))) {
      const name = match[0].toLowerCase();
      if (name !== '*') tests.push((element) => element.localName === name);
    } else if ((match = CLASS.exec(rest))) {
      const wanted = match[1];
      tests.push((element) => (element.getAttribute('class') ?? '').split(/\s+/u).includes(wanted));
    } else if ((match = ID.exec(rest))) {
      const wanted = match[1];
      tests.push((element) => element.getAttribute('id') === wanted);
    } else if ((match = NOT.exec(rest))) {
      const inner = parseCompound(rest.slice(match[0].length), selector);
      const after = rest.slice(match[0].length + inner.consumed);
      if (!after.startsWith(')')) refuse(selector, ':not() takes a single compound selector here');
      tests.push((element) => !inner.tests.every((test) => test(element)));
      match = { 0: rest.slice(0, match[0].length + inner.consumed + 1) };
    } else if ((match = ATTRIBUTE.exec(rest))) {
      const [, name, operator, quoted, single, bare, flag] = match;
      const wanted = quoted ?? single ?? bare ?? '';
      const fold = flag && flag.toLowerCase() === 'i';
      tests.push((element) => {
        let actual = element.getAttribute(name);
        if (actual === null) return false;
        if (!operator) return true;
        let target = wanted;
        if (fold) {
          actual = actual.toLowerCase();
          target = target.toLowerCase();
        }
        switch (operator) {
          case '=':
            return actual === target;
          case '~=':
            return target !== '' && actual.split(/\s+/u).includes(target);
          case '|=':
            return actual === target || actual.startsWith(`${target}-`);
          case '^=':
            return target !== '' && actual.startsWith(target);
          case '$=':
            return target !== '' && actual.endsWith(target);
          case '*=':
            return target !== '' && actual.includes(target);
          default:
            return false;
        }
      });
    } else if (rest.startsWith(':')) {
      refuse(selector, 'a pseudo-class needs user state, layout or a document, and a server has none');
    } else {
      refuse(selector, 'it is not a selector this parser understands');
    }
    rest = rest.slice(match[0].length);
    consumed += match[0].length;
  }
  if (tests.length === 0 && consumed === 0) refuse(selector, 'it is empty');
  return { tests, consumed };
};

/** A full complex selector — compounds joined by combinators — parsed right to left for matching. */
const parseComplex = (selector) => {
  const steps = [];
  let rest = selector.trim();
  let combinator = null;
  for (;;) {
    rest = rest.replace(/^\s+/u, '');
    if (rest === '') break;
    const compound = parseCompound(rest, selector);
    steps.push({ tests: compound.tests, combinator });
    rest = rest.slice(compound.consumed).replace(/^\s*/u, '');
    if (rest === '') break;
    const symbol = /^[>+~]/.exec(rest);
    if (symbol) {
      combinator = symbol[0];
      rest = rest.slice(1);
    } else {
      combinator = ' ';
    }
    if (rest.replace(/^\s+/u, '') === '') refuse(selector, 'it ends with a combinator');
  }
  if (steps.length === 0) refuse(selector, 'it is empty');
  return steps;
};

const cache = new Map();
const compile = (selector) => {
  if (typeof selector !== 'string') selector = `${selector}`;
  let compiled = cache.get(selector);
  if (compiled) return compiled;
  compiled = selector.split(',').map((one) => {
    if (one.trim() === '') refuse(selector, 'it has an empty item in its list');
    return parseComplex(one);
  });
  cache.set(selector, compiled);
  return compiled;
};

const childrenOf = (node) => (node?._entries ?? []).filter((entry) => typeof entry !== 'string');
const siblingsOf = (element) => childrenOf(element._parent);

/** Match one complex selector against one element, walking its steps from right to left. */
const matchesComplex = (element, steps) => {
  const last = steps[steps.length - 1];
  if (!last.tests.every((test) => test(element))) return false;

  let current = element;
  for (let i = steps.length - 2; i >= 0; i--) {
    const step = steps[i];
    const combinator = steps[i + 1].combinator;
    const passes = (candidate) => candidate && step.tests.every((test) => test(candidate));
    if (combinator === '>') {
      current = current._parent;
      if (!passes(current)) return false;
    } else if (combinator === '+') {
      const siblings = siblingsOf(current);
      current = siblings[siblings.indexOf(current) - 1];
      if (!passes(current)) return false;
    } else if (combinator === '~') {
      const siblings = siblingsOf(current);
      const before = siblings.slice(0, siblings.indexOf(current)).reverse().find(passes);
      if (!before) return false;
      current = before;
    } else {
      let above = current._parent;
      while (above && !passes(above)) above = above._parent;
      if (!above) return false;
      current = above;
    }
  }
  return true;
};

/** @param {any} element @param {string} selector */
export const matches = (element, selector) =>
  compile(selector).some((steps) => matchesComplex(element, steps));

/** Every descendant, in document order. */
const descendants = (node, out = []) => {
  for (const child of childrenOf(node)) {
    out.push(child);
    descendants(child, out);
  }
  return out;
};

export const querySelectorAll = (node, selector) => {
  const compiled = compile(selector);
  return descendants(node).filter((element) => compiled.some((steps) => matchesComplex(element, steps)));
};

export const querySelector = (node, selector) => {
  const compiled = compile(selector);
  return descendants(node).find((element) => compiled.some((steps) => matchesComplex(element, steps))) ?? null;
};

export const closest = (element, selector) => {
  const compiled = compile(selector);
  for (let current = element; current; current = current._parent)
    if (current.localName && compiled.some((steps) => matchesComplex(current, steps))) return current;
  return null;
};
