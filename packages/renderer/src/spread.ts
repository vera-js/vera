/**
 * `<div ${spread(props)}>` — bindings whose NAMES are not known when the template is parsed.
 *
 * Ships separately: the renderer holds one property read (a value at element position carrying
 * `_$apply$` applies itself), so an app that never spreads pays only that. This entry imports nothing
 * from the renderer and reaches it only through that protocol, so it works beside any renderer entry.
 *
 * **One key, one rule, decided once.** A key's kind and name follow the renderer's template sigils
 * exactly (`.prop`, `?bool`, `@event`, `&ref`, `!live`, `onClick`), and its verdict — including every
 * refusal — is decided when its binding is first created, never again per render. The rules are
 * repeated rather than imported from the renderer (the bundles cannot share state);
 * `tests/spread-written-parity.test.mjs` drives both spellings against each other.
 *
 * **Security: spread is where the template security model would break**, because its names arrive at
 * runtime, often from data, and are neither greppable nor reviewable. So it refuses, on the client and
 * in the server half (`_$attrs$`) alike: `.innerHTML`/`.outerHTML` (and `!`), `.__proto__`, the `srcdoc`
 * attribute, inline-handler attributes (`onclick` in any casing — `on` + Capital is the event spelling
 * and still works), names that cannot survive markup, and — as the renderer does — a `javascript:` URL
 * where a browser navigates.
 */
import { adoptProperty, call, read, SCRIPT_URL, URL_ATTRIBUTE } from '@verajs/shared-utils';
import type { Untracked } from '@verajs/shared-utils';
import { attributeValueComplaint } from './dev-values.js';

const ATTR = 0;
const PROPERTY = 1;
const BOOLEAN = 2;
/** `!name` — a property compared against the live DOM rather than against what this last wrote. */
const LIVE = 3;
const EVENT = 4;
const REF = 5;
const REFUSED = 6;

/**
 * A name that cannot be written into a tag: the HTML attribute-name restriction (control characters,
 * whitespace, `"`, `'`, `>`, `/`, `=`) plus `<` and a backtick — refused identically on both sides, so a
 * key cannot work here and vanish server-side. Skipped, never thrown: one bad key must not cost a render.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /^$|[\s"'>/=<`]|[\u0000-\u001f\u007f]/;

/** Development only: why a key was refused, by refusal code. */
const WHY = __DEV__
  ? [
      '',
      'an attribute name cannot contain whitespace, a quote, `<`, `>`, `/`, `=` or a control character, and one that cannot be written into markup would not survive server rendering',
      'write it in the template — html`<div .innerHTML=${trusted}>` — sanitized first (renderer README, security note)',
      "assigning __proto__ replaces the element's own prototype and destroys it — no property write does this, and no use of it is legitimate",
      'an inline iframe document is markup injection by definition — bind the property in the template (`.srcdoc=${trusted}`) if you truly mean it',
      'an inline handler attribute is code from data — pass a function as `on` + Capital (onClick) or `@click` instead',
    ]
  : [];

/**
 * A key's kind and name, and — for a refused key — why (`[REFUSED, code]`). The twin of the renderer's
 * template construction; a refused key's verdict never changes, so it is decided once per binding.
 */
const resolve = (key: string): [number, string | number] => {
  const first = key[0];
  let kind = first === '.' ? PROPERTY : first === '?' ? BOOLEAN : first === '@' ? EVENT : first === '&' ? REF : first === '!' ? LIVE : ATTR;
  let name = kind === ATTR ? key : key.slice(1);
  if (kind === ATTR && /^on[A-Z]/.test(key)) {
    kind = EVENT;
    name = key.slice(2).toLowerCase();
  }
  const property = kind === PROPERTY || kind === LIVE;
  const refusal = UNSAFE_NAME.test(name)
    ? 1
    : property && (name === 'innerHTML' || name === 'outerHTML')
      ? 2
      : property && name === '__proto__'
        ? 3
        : kind === ATTR && name.toLowerCase() === 'srcdoc'
          ? 4
          : kind === ATTR && name.length > 2 && /^on/i.test(name)
            ? 5
            : 0;
  return refusal ? [REFUSED, refusal] : [kind, name];
};

/**
 * How a key names a URL a browser navigates to — the renderer's rule, by the same numbers: 0 not one; 1 converted
 * ONCE, and that string checked and written (so a `toString` that answers differently each time cannot pass the
 * check as one URL and be written as another); 2 a custom element's property — often an object
 * (`.data=${rows}`), so only a string is checked and nothing is converted. A refused key needs no case: its
 * name is a refusal code, which no URL attribute name matches.
 */
const urlRule = (kind: number, name: string, custom: boolean) =>
  kind === BOOLEAN || kind === EVENT || kind === REF || !URL_ATTRIBUTE.test(name) ? 0 : kind !== ATTR && custom ? 2 : 1;

/** What `checked` answers for a `javascript:` URL where the rule looks. */
const REFUSE = {};

/** `value` as it is checked AND written under `rule` — converted once, or left as it is — or `REFUSE`. */
const checked = (rule: number, value: unknown) => {
  if (rule === 1 && value != null && typeof value !== 'string') value = `${value}`;
  return rule !== 0 && typeof value === 'string' && SCRIPT_URL.test(value) ? REFUSE : value;
};

const UNSET = {};

/** One key's binding on one element. It is also the `@event` listener — a stable object, so the platform dedupes re-adds. */
class Binding {
  _kind: number;
  _name: string;
  _element: Element;
  /** What the element held before the bag first wrote this key — restored when the key leaves the bag. */
  _initial: unknown = null;
  _committed: unknown = UNSET;
  _handler: unknown = null;
  /** For `.prop`: where adoption stands (`adoptProperty`: 0 still adopting, 1 received, 2 refused). */
  _state = 1;
  /** How this key is checked as a URL (`urlRule`) — decided once, with the element in hand. */
  _url: number;
  /**
   * On a custom element, a property read is the component's GETTER, so it goes through the `untracked` this binding was
   * created with; `null` on a built-in element, whose getters read no state. Decided once.
   */
  _read: Untracked | null;
  constructor(element: Element, key: string, untracked: Untracked) {
    const [kind, name] = resolve(key);
    this._kind = kind;
    this._name = name as string;
    this._element = element;
    const custom = element.localName.includes('-');
    this._read = custom ? untracked : null;
    this._url = urlRule(kind, name as string, custom);
    if (kind === REFUSED) {
      if (__DEV__)
        console.warn(
          `[vera] spread: refusing ${JSON.stringify(key)} — spread names arrive at runtime, which is exactly ` +
            `the property that makes this sink unreviewable; ${WHY[name as number]}.`
        );
      return;
    }
    const el = element as unknown as Record<string, unknown>;
    if (kind === ATTR) this._initial = element.getAttribute(name as string);
    else if (kind === BOOLEAN) this._initial = element.hasAttribute(name as string);
    /** On a custom element this is the component's getter, run on the parent's behalf: read through `untracked`. */
    else if (kind === PROPERTY || kind === LIVE) this._initial = custom ? untracked(read, el, name as string) : el[name as string];
    if (kind === PROPERTY && custom) this._state = 0;
  }
  /** A function is called with the element as `this`; an object is invoked through its `handleEvent`. */
  handleEvent(event: Event) {
    const handler = this._handler as EventListener | EventListenerObject | null;
    if (typeof handler === 'function') handler.call(this._element as never, event);
    else if (typeof handler?.handleEvent === 'function') handler.handleEvent(event);
  }
}

const write = (binding: Binding, given: unknown) => {
  const kind = binding._kind;
  const value = checked(binding._url, given);
  const name = binding._name;
  const element = binding._element;
  const el = element as unknown as Record<string, unknown>;
  if (kind === REFUSED) return;
  if (value === REFUSE) {
    if (__DEV__ && given !== binding._committed)
      console.warn(`[vera] spread: \`${name}\` was given a javascript: URL — refused, and the attribute removed.`);
    binding._committed = given;
    element.removeAttribute(name);
    return;
  }
  if (kind === LIVE) {
    binding._committed = value;
    if ((binding._read !== null ? binding._read(read, el, name) : el[name]) !== value) el[name] = value;
    return;
  }
  if (value === binding._committed) return;
  binding._committed = value;
  if (kind === ATTR) {
    if (value == null) element.removeAttribute(name);
    else {
      if (__DEV__) {
        const complaint = attributeValueComplaint(element.localName, name, value);
        if (complaint !== null) console.warn(`[vera] ${complaint}`);
      }
      element.setAttribute(name, `${value}`);
    }
  } else if (kind === PROPERTY) {
    if (binding._state === 1) el[name] = value;
    else if (binding._state === 0) binding._state = adoptProperty(element, name, value);
  } else if (kind === BOOLEAN) element.toggleAttribute(name, !!value);
  else if (kind === REF) {
    if (typeof value === 'function') (value as (el: Element) => void)(element);
    else if (value !== null && typeof value === 'object') (value as { value: unknown }).value = element;
  } else {
    if (__DEV__ && value != null && value !== false && typeof value !== 'function' &&
        typeof (value as EventListenerObject)?.handleEvent !== 'function')
      console.warn(
        `[vera] spread: @${name} on <${element.localName}> was given ` +
          `${typeof value === 'object' ? 'an object with no handleEvent method' : `a ${typeof value}`}, which cannot ` +
          `listen — the event will do nothing.\nPass a function, or an object with a handleEvent method. A missing ` +
          'handler is `undefined` or `false`, both of which are fine; this is neither.'
      );
    if (binding._handler === null && value != null) element.addEventListener(name, binding);
    binding._handler = value ?? null;
  }
};

/**
 * Each binding is owned by the renderer's binding record it arrived through (the `key`), so one element can
 * carry several spreads. A key that leaves the bag is written back to what the element held before.
 */
const owned = new WeakMap<object, Map<string, Binding>>();
/**
 * `untracked` is `_$apply$`'s third argument — core's, through the renderer; `call` when a renderer leaves it out.
 * Each binding keeps the one it was CREATED with, so nothing about it is paid per render, and an apply nested inside
 * another (a component setter rendering a spread) can never change what the outer's bindings use.
 */
function apply(this: SpreadResult, element: Element, key: object, untracked: Untracked = call) {
  const props = this._props;
  let bindings = owned.get(key);
  if (bindings === undefined) owned.set(key, (bindings = new Map()));
  let count = 0;
  for (const name in props) {
    count++;
    let binding = bindings.get(name);
    if (binding === undefined) bindings.set(name, (binding = new Binding(element, name, untracked)));
    write(binding, props[name]);
  }
  if (bindings.size !== count)
    for (const [name, binding] of bindings)
      if (!(name in props)) {
        bindings.delete(name);
        write(binding, binding._initial);
      }
}

/**
 * The server half of the protocol: `[kind, name, value]` for each key `@verajs/ssr` should serialize —
 * `a`ttribute, `b`oolean, `p`roperty, `e`vent, `r`ef — with every refusal and every refused URL already
 * applied, by the same `resolve` the client uses, so the two cannot disagree.
 */
function attributes(this: SpreadResult): [string, string, unknown][] {
  const out: [string, string, unknown][] = [];
  for (const key in this._props) {
    const [kind, name] = resolve(key);
    /** No element here: a property key is judged as a custom element's — the server only ever delivers one to a component. */
    const rule = urlRule(kind, name as string, true);
    const value = checked(rule, this._props[key]);
    if (kind === REFUSED || value === REFUSE) continue;
    out.push([kind === ATTR ? 'a' : kind === BOOLEAN ? 'b' : kind === EVENT ? 'e' : kind === REF ? 'r' : 'p', name as string, value]);
  }
  return out;
}

/** The branded, self-applying result — what the renderer's element position recognizes. */
type SpreadResult = {
  _props: Record<string, unknown>;
  _$apply$: unknown;
  _$attrs$: unknown;
};

/**
 * Binds every key of `props` to the element it is placed on. Keys follow the template sigils — `.prop`,
 * `?bool`, `@event` (or `onClick`), `&ref`, `!live` — and a plain key is an attribute.
 *
 * Already-branded input is returned as-is (JSX compiles `{...spread(x)}` to a spread of a spread). A
 * value that is not a plain object is refused in BOTH builds — a string would otherwise be iterated by
 * character index into attributes named `0`, `1`, `2` — and development says so.
 */
export const spread = (props: object | null | undefined): SpreadResult => {
  if (props !== null && typeof props === 'object' && (props as SpreadResult)._$apply$ !== undefined)
    return props as SpreadResult;
  if (props === null || typeof props !== 'object' || Array.isArray(props)) {
    if (__DEV__)
      console.warn(
        `[vera] spread: ignoring a props bag that is not a plain object — received ` +
          `${Array.isArray(props) ? 'an array' : typeof props === 'object' ? 'null' : `a ${typeof props}`}. ` +
          `A string is iterated by character index, so \`spread('text')\` would set attributes named ` +
          `0, 1, 2 and 3; anything else applies nothing at all. This is usually an import or a ` +
          `property that resolved to something unexpected.`
      );
    props = {};
  }
  return { _props: props as Record<string, unknown>, _$apply$: apply, _$attrs$: attributes };
};

/** Every key as a property: `props({ items })` is `spread({ '.items': items })` — how a component receives data. */
export const props = <T extends object = Record<string, unknown>>(values: Partial<T>): SpreadResult => {
  const sigiled: Record<string, unknown> = {};
  for (const key of Object.keys(values)) sigiled[`.${key}`] = (values as Record<string, unknown>)[key];
  return spread(sigiled);
};
