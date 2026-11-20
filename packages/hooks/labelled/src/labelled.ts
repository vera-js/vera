/**
 * **`labelled`: a control's name, description and error, through the platform's own id references.**
 *
 * The control is named by `label[for]` when it is labelable (a native control or a form-associated host), and by
 * `aria-labelledby` otherwise, because `for` names nothing else. Hint and count are always in `aria-describedby`; an
 * error joins it only while shown, with `aria-invalid="true"`. The hook only WRITES: when to show an error (`focusout`,
 * `invalid`, `change`) is the caller's decision, so it adds no listener and has no realm to get wrong.
 *
 * It writes ids only where an element has none, and every id it writes is one it generated. It never creates an
 * element, moves one, or writes text. `release()` puts back every value it found, user-set ones included, and removes
 * only the tokens it added, so a token the page adds meanwhile survives.
 */
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import type { LabelledParts, LabelledWiring } from './types.js';

/**
 * **The library-wide id counter (Brian's go, 2026-11-20).** Module-level mutable state, shared on purpose across every
 * copy of the library on the page through a global symbol: two copies counting on their own would both hand out `vu1`,
 * and a random per-copy prefix would give a server and a client different ids, so every hydrated id would change. A
 * counter matches whenever components wire in the same order, which is what hydration does; an element that already has
 * an id (a server render's) keeps it and takes no number.
 */
const uid: { n: number } = ((globalThis as Record<symbol, unknown>)[Symbol.for('vera.uid')] ??= { n: 0 }) as { n: number };

/** On a wired control: its owner's host and release, so a nearer caller can take over and a farther one stands aside. */
const OWNER = Symbol.for('vera.labelled');
/** On an element this hook gave an id: that id, so a re-wire (a takeover, a second wiring) gives it the same one back. */
const GIVEN = Symbol.for('vera.uid.given');
/** On a control the unnamed warning was printed for, so it prints once per control. Development only. */
const WARNED = Symbol.for('vera.labelled.warned');

type Owner = { host: Element; release: () => void };
type Marked = Element & { [OWNER]?: Owner; [GIVEN]?: string; [WARNED]?: true };

/** The handle a farther caller gets: it owns nothing, so neither call does anything. */
const INERT: LabelledWiring = Object.freeze({ show: () => {}, release: () => {} });

/** The tokens of a space-separated attribute value. */
const tokensOf = (value: string | null): string[] => (value ? value.split(/[\t\n\f\r ]+/).filter((token) => token !== '') : []);

/** `value` with `add` appended, each once, after the tokens already there. */
const withTokens = (value: string | null, add: readonly string[]): string => {
  const have = tokensOf(value);
  for (const token of add) if (!have.includes(token)) have.push(token);
  return have.join(' ');
};

/** `value` without `remove`. */
const withoutTokens = (value: string | null, remove: readonly string[]): string =>
  tokensOf(value)
    .filter((token) => !remove.includes(token))
    .join(' ');

/** Whether `id` cannot be one token of an idref list. */
const spaced = (id: string): boolean => id === '' || /[\t\n\f\r ]/.test(id);

/** Whether `el` is a control `label[for]` names: the HTML labelable elements, and a form-associated custom element. */
const labelable = (el: Element): boolean => {
  const name = el.localName;
  if (name === 'input') return (el as HTMLInputElement).type !== 'hidden';
  if (['button', 'meter', 'output', 'progress', 'select', 'textarea'].includes(name)) return true;
  return (el.constructor as { formAssociated?: unknown }).formAssociated === true;
};

/** Whether `node` is `outer` or inside it, crossing shadow roots outward. */
const within = (outer: Node, node: Node | null): boolean => {
  for (let at = node; at; at = at.parentNode ?? (at as ShadowRoot).host ?? null) if (at === outer) return true;
  return false;
};

/**
 * Whether `id` is already an element's in `root`. Read at wire time only: an element inserted later with the same id
 * still collides, so the counter's ids are unique on a best-effort basis, not guaranteed.
 */
const taken = (root: Node, id: string): boolean => {
  const scope = root as Partial<Document> & Partial<Element>;
  if (typeof scope.getElementById === 'function') return scope.getElementById(id) !== null;
  /** A disconnected subtree's root is an element: the counter's ids are `vu` and digits, so the selector needs no escaping. */
  return scope.id === id || scope.querySelector?.(`[id="${id}"]`) != null;
};

/**
 * Whether a control has an accessible name by one of the shapes this hook can see. The rest are never judged.
 *
 * A `label[for]` is found by comparing each label's `for` with the id, not through `control.labels`: the server's DOM has
 * no `labels`, and it warned about every labelled control rendered there (a jsdom/ssr differential, 2026-11-20). One
 * comparison also needs no selector escaping for a hostile id.
 */
const named = (control: Element, root: Node): boolean =>
  ['aria-label', 'aria-labelledby', 'title'].some((name) => control.hasAttribute(name)) ||
  (labelable(control) && control.id !== '' && [...((root as ParentNode).querySelectorAll?.('label[for]') ?? [])].some((label) => label.getAttribute('for') === control.id)) ||
  control.closest('label') !== null ||
  (control.localName === 'button' && (control.textContent ?? '').trim() !== '');

/**
 * @param control The element that takes focus: a native control, or a composite's control part.
 * @param parts The calling component's host and the parts to wire; each is optional but `host`.
 * @return `show` and `release`, or a handle that owns nothing when a nearer caller already wired the control.
 */
export const labelled = (control: Element, parts: LabelledParts): LabelledWiring => {
  const marked = control as Marked;
  const { host } = parts;
  const owner = marked[OWNER];
  if (owner) {
    /** The NEARER caller owns it: a caller whose host is inside the owner's takes over, any other stands aside. */
    if (owner.host === host || !within(owner.host, host)) return INERT;
    owner.release();
  }

  const subject = `<${control.localName}>`;
  const root = control.getRootNode();
  /** Every attribute value this wiring replaced, first value only, to put back at release. */
  const found: [Element, string, string | null][] = [];
  /** Every token this wiring added, per element and attribute, to take out at release. */
  const added: [Element, string, string[]][] = [];
  /** The token attributes the control already carried when wired. */
  const hadAttr = new Set(['aria-describedby', 'aria-labelledby'].filter((name) => control.hasAttribute(name)));

  const write = (el: Element, name: string, value: string) => {
    if (!found.some(([e, n]) => e === el && n === name)) found.push([el, name, el.getAttribute(name)]);
    el.setAttribute(name, value);
  };
  const putBack = (el: Element, name: string) => {
    const entry = found.find(([e, n]) => e === el && n === name);
    if (!entry) return;
    if (entry[2] === null) el.removeAttribute(name);
    else el.setAttribute(name, entry[2]);
  };
  const addTokens = (name: string, ids: string[]) => {
    const fresh = ids.filter((id) => !tokensOf(control.getAttribute(name)).includes(id));
    if (fresh.length === 0) return;
    let entry = added.find(([e, n]) => e === control && n === name);
    if (!entry) added.push((entry = [control, name, []]));
    entry[2].push(...fresh);
    control.setAttribute(name, withTokens(control.getAttribute(name), fresh));
  };
  const takeTokens = (name: string, ids: string[]) => {
    const entry = added.find(([e, n]) => e === control && n === name);
    const mine = entry ? ids.filter((id) => entry[2].includes(id)) : [];
    if (!entry || mine.length === 0) return;
    entry[2] = entry[2].filter((id) => !mine.includes(id));
    const left = withoutTokens(control.getAttribute(name), mine);
    /** Emptied: absent again if it was absent when wired, present and empty if it was present. */
    if (left === '' && !hadAttr.has(name)) control.removeAttribute(name);
    else control.setAttribute(name, left);
  };

  /** `el`'s id, giving it one from the counter (the same one as last time, when free) if it has none. */
  const idOf = (el: Element): string => {
    const own = el.getAttribute('id');
    if (own !== null) return own;
    const was = (el as Marked)[GIVEN];
    let id = was !== undefined && !taken(el.getRootNode(), was) ? was : '';
    while (id === '') {
      const next = `vu${++uid.n}`;
      if (!taken(el.getRootNode(), next)) id = next;
    }
    (el as Marked)[GIVEN] = id;
    write(el, 'id', id);
    return id;
  };
  /** Whether `part` can be referenced from the control; development says why not when it cannot. */
  const reachable = (part: Element, what: string): boolean => {
    if (part.getRootNode() === root) return true;
    if (__DEV__) console.warn(diagnostic('labelled', subject, 'labelled-cross-root', __DEV__ && PROSE['labelled-cross-root'](what)));
    return false;
  };
  /** `part`'s id as one idref token, or null (development saying why) when its own id holds whitespace. */
  const tokenOf = (part: Element, what: string): string | null => {
    const id = idOf(part);
    if (!spaced(id)) return id;
    if (__DEV__) console.warn(diagnostic('labelled', subject, 'labelled-id-token', __DEV__ && PROSE['labelled-id-token'](what)));
    return null;
  };

  const controlId = idOf(control);
  const { label, hint, count } = parts;
  if (label && reachable(label, 'label')) {
    if (labelable(control)) write(label, 'for', controlId);
    else {
      const token = tokenOf(label, 'label');
      if (token !== null) addTokens('aria-labelledby', [token]);
    }
  }
  const described: string[] = [];
  for (const [part, what] of [
    [hint, 'hint'],
    [count, 'count'],
  ] as const)
    if (part && reachable(part, what)) {
      const token = tokenOf(part, what);
      if (token !== null) described.push(token);
    }
  addTokens('aria-describedby', described);
  /** Each error's id, given now so `show` writes only the description and `aria-invalid`. */
  const errors = new Map<Element, string>();
  for (const error of parts.errors ?? [])
    if (reachable(error, 'error')) {
      const token = tokenOf(error, 'error');
      if (token !== null) errors.set(error, token);
    }

  if (__DEV__ && !named(control, root) && !marked[WARNED]) {
    marked[WARNED] = true;
    console.warn(diagnostic('labelled', subject, 'labelled-unnamed', __DEV__ && PROSE['labelled-unnamed']()));
  }

  let shown: Element | null = null;
  let released = false;
  const show = (error: Element | null) => {
    if (released || error === shown || (error !== null && !errors.has(error))) return;
    if (shown) takeTokens('aria-describedby', [errors.get(shown) as string]);
    shown = error;
    if (error) {
      addTokens('aria-describedby', [errors.get(error) as string]);
      write(control, 'aria-invalid', 'true');
    } else putBack(control, 'aria-invalid');
  };
  const release = () => {
    if (released) return;
    released = true;
    for (const [, name, ids] of added) takeTokens(name, [...ids]);
    for (const [el, name] of found) putBack(el, name);
    if (marked[OWNER] === self) delete marked[OWNER];
  };
  const self: Owner = { host, release };
  marked[OWNER] = self;
  return { show, release };
};
