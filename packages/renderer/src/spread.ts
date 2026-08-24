/**
 * `<div ${spread(props)}>` — bindings whose names are not known when the template is parsed.
 *
 * Template renderers bake attribute names in at parse time; that is what makes them small and fast,
 * and it is why neither this renderer nor lit-html has had spread. Lit's spread PR has sat open as a
 * draft since 2021, blocked on the questions answered below.
 *
 * **Why this ships separately.** The renderer holds one property read — a value at element position
 * carrying `_$apply$` applies itself — and nothing else, so a base bundle grows 16 B rather than
 * 176 B and an app that never spreads pays only that. Core and the renderer are the two packages
 * where weight is absolute; this is not one of them, but it is still measured.
 *
 * The sigil rules are repeated here rather than shared through `@verajs/shared-utils`. That was
 * tried: a shared resolver has to hand back both a kind and a name, and the tuple it allocates cost
 * the renderer 10 B. Principle #5 permits deliberate duplication where two callers can legitimately
 * diverge; #7 decides it, because the renderer is where bytes are not negotiable.
 */

const ATTR = 0;
const PROPERTY = 1;
const BOOLEAN = 2;
/** `!name` — a property compared against the live DOM rather than against what this last wrote. */
const LIVE = 3;
const EVENT = 4;
const REF = 5;

/**
 * A key that cannot be written into a tag, and therefore cannot be used at all.
 *
 * Measured in Chromium, `setAttribute` accepts `"`, `'` and `<` and rejects whitespace, `>`, `=`,
 * `/` and NUL — but a name carrying a quote or a `<` cannot survive **markup**, so `@verajs/ssr`
 * has to refuse it, and a key that works here and vanishes server-side is worse than one that works
 * nowhere. The rule is therefore the HTML attribute-name restriction (control characters,
 * whitespace, `"`, `'`, `>`, `/`, `=`) plus `<` and a backtick, applied identically on both sides.
 *
 * Skipped rather than thrown. `setAttribute` throws `InvalidCharacterError` on some of these, which
 * took down the whole render — for one bad key in a props bag, on a binding whose entire purpose is
 * names that are not known until runtime.
 *
 * The control-character range is the point of the rule, not a mistake in it: a name carrying one
 * is exactly what must never reach markup.
 */
// eslint-disable-next-line no-control-regex
const UNSAFE_NAME = /^$|[\s"'>/=<`]|[\u0000-\u001f\u007f]/;

/** Module-local: one identity comparison, not a global symbol-registry lookup per binding. */
const UNSET = Symbol();

/**
 * A class, not an object literal, so `handleEvent` exists once on the prototype. As a literal it was
 * a fresh closure per bound key — allocation proportional to the size of every props bag.
 */
class Binding {
  _kind: number;
  _name: string;
  _element: Element;
  /** What the element held before this binding took over. Releasing puts it back. */
  _initial: unknown;
  _committed: unknown = UNSET;
  _handler: EventListener | null = null;

  constructor(element: Element, key: string) {
    const first = key[0];
    let kind =
      first === '.'
        ? PROPERTY
        : first === '?'
          ? BOOLEAN
          : first === '@'
            ? EVENT
            : first === '&'
              ? REF
              : first === '!'
                ? LIVE
                : ATTR;
    let name = kind ? key.slice(1) : key;
    /** `on` + a capital: `onClick` ≡ `@click`. All-lowercase `onclick` stays a plain attribute. */
    if (kind === ATTR && first === 'o' && key.charCodeAt(1) === 110 && key.charCodeAt(2) > 64 && key.charCodeAt(2) < 91) {
      kind = EVENT;
      name = key.slice(2).toLowerCase();
    }
    this._kind = kind;
    this._name = name;
    this._element = element;
    this._initial =
      kind === ATTR
        ? element.getAttribute(name)
        : kind === BOOLEAN
          ? element.hasAttribute(name)
          : kind === PROPERTY || kind === LIVE
            ? (element as unknown as Record<string, unknown>)[name]
            : null;
  }

  handleEvent(event: Event) {
    if (this._handler) this._handler.call(this._element as never, event);
  }
}

/**
 * Keyed by the **part**, not the element.
 *
 * Keyed by element, `<div ${spread(a)} ${spread(b)}>` shares one map: whichever applies second sees
 * the other's keys as absent from its own props and releases them. Measured — the first spread's
 * attributes silently vanished. The part is one per element-position slot, which is exactly the
 * ownership boundary, and the renderer reuses it across renders.
 */
const owned = new WeakMap<object, Map<string, Binding>>();

const write = (binding: Binding, value: unknown) => {
  /** One comparison per key per render — the same dirty check a written binding gets. */
  /**
   * A live property asks the element rather than its own memory — see `AttrPart` in the renderer.
   * The dirty check is what keeps a field someone typed into, and it is exactly wrong for a control
   * whose DOM state changes when a *sibling* is interacted with, a radio group being the case.
   */
  if (binding._kind === LIVE) {
    binding._committed = value;
    const live = binding._element as unknown as Record<string, unknown>;
    if (live[binding._name] !== value) live[binding._name] = value;
    return;
  }
  if (value === binding._committed) return;
  binding._committed = value;
  const element = binding._element;
  const name = binding._name;
  const kind = binding._kind;
  if (kind === ATTR) {
    if (value == null) element.removeAttribute(name);
    else element.setAttribute(name, String(value));
  } else if (kind === PROPERTY) {
    (element as unknown as Record<string, unknown>)[name] = value;
  } else if (kind === BOOLEAN) {
    element.toggleAttribute(name, !!value);
  } else if (kind === REF) {
    /**
     * `&name` is the written form's ref sigil (`<input &field=${myRef} />`), and it was the one
     * binding kind a spread could not express: the key fell through to `ATTR` and
     * `setAttribute('&field', …)` threw on the client while the server wrote `&field="[object
     * Object]"` into the markup. A function is called with the element, an object gets it assigned
     * to `.value` — the same two shapes `AttrPart` handles.
     */
    if (typeof value === 'function') (value as (el: Element) => void)(element);
    else if (value !== null && typeof value === 'object') (value as { value: unknown }).value = element;
  } else {
    if (binding._handler === null && value != null) element.addEventListener(name, binding);
    binding._handler = (value as EventListener) ?? null;
  }
};

/**
 * A key that disappeared between renders restores what the element held before the binding existed.
 *
 * This is the question Lit's PR is stuck on, and the trap is asking it as "what value means absent".
 * For a property there is no answer: assigning `undefined` runs through coercing setters, so
 * dropping `.value` yields `""` rather than reverting, and `delete` cannot remove a prototype
 * accessor. Asked instead as *"undo what this binding did"* it is well defined for every kind and
 * never invents a value the author did not write — the initial state was, by definition, acceptable
 * before the binding arrived.
 *
 * And asked that way it needs no code of its own: releasing is writing the initial value back.
 * `null` removes an attribute, `false` untoggles a boolean, `undefined` restores a property to
 * pristine, and an event handler falls to `null` — every case the existing commit already handles.
 * The separate per-kind teardown this replaced was fourteen lines saying the same thing twice.
 *
 * Deliberately unguarded by an ownership check (`is the value still the one we wrote?`). That only
 * matters when a component reassigns a property its parent is binding, which is already confused;
 * per principle #3 the machinery waits for evidence rather than being pre-built.
 */
function apply(this: { _props: Record<string, unknown> }, element: Element, part: object) {
  const props = this._props;
  let bindings = owned.get(part);
  if (bindings === undefined) owned.set(part, (bindings = new Map()));

  /**
   * Counted here rather than with `Object.keys(props).length`, which allocates an array on every
   * render of every spread — garbage in the render path, for a number already being walked.
   */
  let count = 0;
  for (const key in props) {
    count++;
    /**
     * Counted before it is skipped, so the size comparison below still describes the key set — a
     * refused key that changed the count would make every render look like a removal.
     */
    if (UNSAFE_NAME.test(key[0] === '.' || key[0] === '?' || key[0] === '@' || key[0] === '&' ? key.slice(1) : key)) {
      if (__DEV__)
        console.warn(
          `@verajs/renderer/spread: ignoring the key ${JSON.stringify(key)} — an attribute name ` +
            `cannot contain whitespace, a quote, \`<\`, \`>\`, \`/\`, \`=\` or a control character, ` +
            `and one that cannot be written into markup would not survive server rendering.`
        );
      continue;
    }
    let binding = bindings.get(key);
    if (binding === undefined) bindings.set(key, (binding = new Binding(element, key)));
    write(binding, props[key]);
  }

  /**
   * A size mismatch is the only way a key can have gone: every key in `props` was just visited, so
   * equal sizes means equal sets. The steady-state render of an unchanged shape — overwhelmingly the
   * common case — costs one integer comparison, not a scan.
   */
  if (bindings.size !== count) {
    for (const [key, binding] of bindings) {
      if (key in props) continue;
      bindings.delete(key);
      write(binding, binding._initial);
    }
  }
}

/**
 * The server half of the protocol: hand back every binding, resolved, and let the renderer that
 * asked decide what belongs in markup.
 *
 * Deliberately *not* a serializer. This package knows what a key means — `.value` is a property,
 * `?disabled` a boolean, `onClick` an event — and nothing else. Whether a property belongs in
 * server markup (`value`, `checked`, `selected` do; the rest are client state) and how a value is
 * escaped are `@verajs/ssr`'s decisions, and principle #8 wants escaping in exactly one place. So
 * this returns data, never a string.
 *
 * Kinds are single characters rather than the module's numeric constants, because this crosses a
 * package boundary: `a`ttribute, `b`oolean, `p`roperty, `e`vent, `r`ef. A ref is client state with
 * no markup, exactly like an event, and the serializer drops both.
 */
function attributes(this: { _props: Record<string, unknown> }): [string, string, unknown][] {
  const out: [string, string, unknown][] = [];
  for (const key in this._props) {
    const first = key[0];
    /** `!` reports as a property: the server has nothing to re-read, so it serializes as `.` does. */
    const kind =
      first === '.' || first === '!'
        ? 'p'
        : first === '?'
          ? 'b'
          : first === '@'
            ? 'e'
            : first === '&'
              ? 'r'
              : 'a';
    if (kind !== 'a') {
      out.push([kind, key.slice(1), this._props[key]]);
    } else if (first === 'o' && key.charCodeAt(1) === 110 && key.charCodeAt(2) > 64 && key.charCodeAt(2) < 91) {
      out.push(['e', key.slice(2).toLowerCase(), this._props[key]]);
    } else {
      out.push(['a', key, this._props[key]]);
    }
  }
  return out;
}

/**
 * Branded rather than duck-typed: the element position already means "element ref", and a props bag
 * is indistinguishable from a ref object — `{ value: 5 }` is legitimately either.
 */
export const spread = (props: Record<string, unknown>) => ({
  _props: props,
  _$apply$: apply,
  _$attrs$: attributes,
});
