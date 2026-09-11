/**
 * The interaction catalog — DESIGN-DIRECTIVES §10, each row built after its §12 pass (the passes
 * are recorded compactly in the doc's BUILD LOG; the settled decisions they execute are §20's).
 *
 * The cost model holds throughout: plain events are pure delegation (zero per-element work);
 * reflections are one engine-owned hook each; `state`/`every`/`sync`/`persist`/focus are
 * setup-only or setup+apply. Nothing here touches the renderer — adjectives, never nouns.
 */
import { isObject, sameValue } from './parse.js';
import type { Ctx, Directive } from './types.js';

/* ── reflections ─────────────────────────────────────────────────────────────────────────── */

/** `show` reflects to `hidden`; the engine's adopted base rule makes `hidden` unbeatable (§20.2). */
const show: Directive = {
  name: 'show',
  value: 'expression',
  docs: { summary: 'Shows the element while the expression is truthy.', example: 'data-vd-show="open"' },
  /** Declarative: the server writes this reflection, so it is right before any JS runs. */
  ssr: true,
  apply(el, value) {
    /**
     * **`hidden` is an HTMLElement IDL property, so on an SVG child it sets an inert expando** —
     * no attribute is written, the base sheet's `[hidden]` rule never matches, and the element
     * stays visible in silence. §16's ledger promised this fallback ("`show` falls back to
     * `display:none` where `hidden` has no effect") and the code did not have it. The namespace
     * is the realm-safe test — `instanceof` asks about THIS realm's HTMLElement, which is wrong
     * for an adopted node.
     */
    if (el.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      (el as HTMLElement).hidden = !value;
      return;
    }
    const style = (el as unknown as { style?: CSSStyleDeclaration }).style;
    if (!style) return;
    if (value) style.removeProperty('display');
    else style.setProperty('display', 'none');
  },
};

const classDirective: Directive = {
  name: 'class',
  value: 'object',
  docs: { summary: 'Toggles classes from an object of name: expression.', example: 'data-vd-class="{ is-open: open }"' },
  /** Declarative: the server writes this reflection, so it is right before any JS runs. */
  ssr: true,
  apply(el, value, ctx) {
    if (!isObject(value as never)) {
      ctx.reject('class-not-object');
      return;
    }
    const entries = value as Record<string, unknown>;
    /** classList, never className — SVG's className is an SVGAnimatedString (design §16). */
    for (const name of Object.keys(entries)) el.classList.toggle(name, !!ctx.eval(entries[name]));
  },
};

/** `style` sets properties from an object of prop: expression — custom properties included. */
const style: Directive = {
  name: 'style',
  value: 'object',
  docs: { summary: 'Sets style properties from an object of prop: expression.', example: 'data-vd-style="{ opacity: open ? 1 : 0 }"' },
  /** Declarative: the server writes this reflection, so it is right before any JS runs. */
  ssr: true,
  apply(el, value, ctx) {
    if (!isObject(value as never)) {
      ctx.reject('style-not-object');
      return;
    }
    const entries = value as Record<string, unknown>;
    const styles = (el as HTMLElement).style;
    for (const prop of Object.keys(entries)) {
      const v = ctx.eval(entries[prop]);
      if (v === null || v === undefined || v === false) styles.removeProperty(prop);
      else styles.setProperty(prop, String(v));
    }
  },
};

/** `text` writes textContent — never markup, and it REPLACES all children (design §20, minor). */
const text: Directive = {
  name: 'text',
  value: 'expression',
  docs: { summary: 'Sets the element text from the expression. textContent, never markup.', example: 'data-vd-text="total"' },
  /** Declarative: the server writes this reflection, so it is right before any JS runs. */
  ssr: true,
  apply(el, value) {
    const next = value === null || value === undefined ? '' : String(value);
    /** Compare before writing (the list/counts rule, applied to the DOM): an identical write
     *  still replaces the text node — killing the reader's selection and paying a paint for
     *  nothing. Found live: selecting the value in a demo was impossible while any state
     *  churned, because every settle rewrote an unchanged string. */
    if (el.textContent !== next) el.textContent = next;
  },
};

/**
 * `bind-*` — LIST-FREE semantics by VALUE TYPE (§20.4): false/null/undefined removes, true is
 * present-empty, anything else writes the string. `aria-*` always stringifies (aria-expanded
 * needs the literal word "false"). The form four (value/checked/selected/open) write the LIVE
 * property, because the attribute form is only the default. The refuse-list guards the sinks:
 * href/src/srcdoc and any on* are navigation and script; style and class each have their one door.
 */
const FORM_PROPS = new Set(['value', 'checked', 'selected', 'open']);
/**
 * Sinks a bound expression may never reach. Three groups, and the middle one was MISSING:
 * navigation and script (`href`, `src`, `srcdoc`, `on*`); **the submit and fetch sinks a form
 * can carry** — `formaction`/`action` redirect a POST, `srcset`/`poster`/`data`/`background`
 * fetch, `ping` beacons — which an attribute an author or a CMS writes must not be able to aim;
 * and the two that simply have their own door (`style`, `class`). `hidden` joins them for the
 * same one-door reason: it is `show` with inverted polarity.
 */
const REFUSED_BIND = new Set([
  'href', 'src', 'srcdoc', 'style', 'class',
  'action', 'formaction', 'srcset', 'ping', 'poster', 'data', 'background',
  'hidden',
]);
const bind: Directive = {
  name: {
    match: (suffix: string) => (suffix.startsWith('bind-') ? { target: suffix.slice(5) } : null),
  },
  value: 'expression',
  docs: { summary: 'Binds one attribute (or form property) to an expression.', example: 'data-vd-bind-aria-expanded="open"' },
  /** Declarative: the server writes this reflection, so it is right before any JS runs. */
  ssr: true,
  setup(_el, ctx) {
    const target = (ctx.selection as { target: string }).target;
    if (REFUSED_BIND.has(target) || target.startsWith('on')) {
      ctx.reject('bind-refused-target', [target]);
      return;
    }
    return {
      apply: (element: Element, value: unknown) => {
        if (FORM_PROPS.has(target)) {
          (element as unknown as Record<string, unknown>)[target] =
            target === 'value' ? String(value ?? '') : !!value;
          return;
        }
        if (target.startsWith('aria-')) {
          if (value === null || value === undefined) element.removeAttribute(target);
          else element.setAttribute(target, String(value));
          return;
        }
        if (value === false || value === null || value === undefined) element.removeAttribute(target);
        else if (value === true) element.setAttribute(target, '');
        else element.setAttribute(target, String(value));
      },
    };
  },
};

/**
 * `init` — assignments run ONCE when this element activates, deterministic whether the pack
 * arrived with the page or over the network.
 *
 * Its own directive rather than an `on-*` member, because activation is not an event and pretending
 * otherwise is what made `on-load` ambiguous. Alpine (`x-init`) and the WP Interactivity API
 * (`data-wp-init`) both landed here independently, which is the strongest evidence available that
 * it is what an author looks for.
 */
const init: Directive = {
  name: 'init',
  value: 'object',
  priority: 70,
  docs: { summary: 'Runs an assignments object once, when the element activates.', example: 'data-vd-init="{ ready: true }"' },
  setup(_el, ctx) {
    ctx.runAttr('data-vd-init');
  },
};

/* ── reacting to state ───────────────────────────────────────────────────────────────────── */

/**
 * **React to a state change you did not author.**
 *
 * `data-vd-watch="{ q: { page: 1 } }"` — when `q` changes, run `{ page: 1 }`.
 *
 * The motivating case is a filtered list, and it is worth stating precisely because the obvious
 * version of it is already handled: `region` CLAMPS `page` to the page count, so narrowing a search
 * until the results shrink past your page moves you back on its own. What the clamp cannot catch is
 * a new query whose results are still long — type a fresh search on page 4 of 8 and you land on
 * page 4 of the NEW results rather than at the start of them, which no reader expects.
 *
 * **Why not write it where the change happens**, `{ q: $value, page: 1 }`? For a handler you
 * authored, do exactly that — it is simpler and needs nothing from this directive. `watch` earns
 * its place where the write is NOT yours: a shared link seeding `q` through the query pack, a fetch
 * patching state, another component writing the same key. None of those has a handler to amend.
 *
 * **It does not fire on the first pass**, and that is load-bearing rather than an optimisation. The
 * first observation establishes the baseline; firing on it would reset `page` to 1 the instant
 * `?q=ber&page=3` loaded, breaking the query pack's guarantee that a shared link reproduces what
 * the sender saw — the feature sabotaging the feature it exists to serve.
 */
const watch: Directive = {
  name: 'watch',
  value: 'object',
  priority: 45,
  docs: {
    summary: 'Runs assignments when a state key changes: { key: { writes } }.',
    example: 'data-vd-watch="{ q: { page: 1 } }"',
  },
  setup(_el, ctx) {
    const previous = new Map<string, unknown>();
    /**
     * **The run cap resets on a QUIET pass, not on a timer** (design §16: per element, per settle).
     *
     * It reset on a microtask first, which is not a settle and does not behave like one: core
     * schedules re-runs on animation frames, and microtasks flush between them — so a watch writing
     * once per frame reset its own counter every frame and would have looped for ever, while a
     * burst inside one frame tripped correctly. A pass that fires NOTHING is the real settled
     * signal, it needs no scheduling at all, and it deleted two variables and a `queueMicrotask`
     * along with the bug.
     */
    let runs = 0;
    return {
      apply: (_element: Element, value: unknown) => {
        if (!isObject(value as never)) {
          ctx.reject('watch-not-object');
          return;
        }
        const entries = value as Record<string, unknown>;
        const keys = Object.keys(entries);
        /**
         * Baselines for keys no longer watched are DROPPED. An edited attribute that removes `q`
         * and later restores it would otherwise compare against a baseline from before the edit and
         * fire on a value that never changed while anything was watching it.
         */
        for (const key of previous.keys()) if (!keys.includes(key)) previous.delete(key);

        const firing: string[] = [];
        for (const key of keys) {
          /** Read through context — that IS the subscription, and why this re-runs at all. */
          const now = ctx.get(key);
          /**
           * A key seen for the first time only establishes a baseline. `previous.has` carries that
           * on its own; a separate `seeded` flag beside it said the same thing in a second way and
           * could only ever drift from it.
           */
          const known = previous.has(key);
          const before = previous.get(key);
          previous.set(key, now);
          if (known && !sameValue(before, now)) firing.push(key);
        }

        if (!firing.length) {
          runs = 0;
          return;
        }
        if (++runs > 10) {
          ctx.reject('watch-loop');
          return;
        }
        for (const key of firing) {
          const body = entries[key];
          if (!isObject(body as never)) {
            ctx.reject('watch-entry-not-object', [key]);
            continue;
          }
          ctx.run(body as never);
        }
      },
    };
  },
};

/* ── timers ──────────────────────────────────────────────────────────────────────────────── */

/** `every` — an object of interval: assignments (names select, values configure; §20.7's cousin). */
const every: Directive = {
  name: 'every',
  value: 'object',
  docs: { summary: 'Runs assignments on an interval: { ms: { writes } }.', example: 'data-vd-every="{ 3000: { tick: tick + 1 } }"' },
  setup(_el, ctx) {
    const timers: ReturnType<typeof setInterval>[] = [];
    return {
      apply: (_element: Element, value: unknown) => {
        /** Re-parse on value change: clear the old timers, start the new set. */
        for (const t of timers.splice(0)) clearInterval(t);
        if (!isObject(value as never)) {
          ctx.reject('every-not-object');
          return;
        }
        const entries = value as Record<string, unknown>;
        for (const key of Object.keys(entries)) {
          const ms = Number(key);
          if (!Number.isInteger(ms) || ms <= 0) {
            ctx.reject('every-bad-interval', [key]);
            continue;
          }
          const body = entries[key];
          if (!isObject(body as never)) {
            ctx.reject('every-entry-not-object', [ms]);
            continue;
          }
          timers.push(setInterval(() => ctx.run(body as never), ms));
        }
      },
      teardown: () => {
        for (const t of timers.splice(0)) clearInterval(t);
      },
    };
  },
};

/* ── two-way + persistence ───────────────────────────────────────────────────────────────── */

/**
 * `sync` — control-aware two-way binding on ONE key. State wins at activation, events win after
 * (§20.5). Checkbox rides checked/change, select rides value/change, text rides value/input
 * (change on a text field only fires at blur, which makes typing feel dead — the omniwp lesson).
 */
const sync: Directive = {
  name: 'sync',
  value: 'literal',
  docs: { summary: 'Two-way binds a form control to one state key.', example: 'data-vd-sync="draft"' },
  /**
   * The mode is the native form model, verbatim: a RADIO is one choice (its `value`, written when
   * checked), a CHECKBOX carrying an explicit `value` is membership in an array (the multi-facet
   * shape — checked adds, unchecked removes), a bare checkbox stays a boolean, a MULTI select is
   * the whole array, and everything else is a string. `select-multiple` is detected by `type`,
   * which is the native vocabulary — and exactly what `<vera-select multi>` reflects so that
   * feature-detecting code treats it as a real select; its `.value` is already the array.
   */
  setup(el, ctx) {
    const control = el as HTMLInputElement;
    const isRadio = control.type === 'radio';
    const isMembership = control.type === 'checkbox' && el.hasAttribute('value');
    const isCheckbox = control.type === 'checkbox' && !isMembership;
    const isMultiple = control.type === 'select-multiple';
    const isSelect = isMultiple || control.type === 'select-one' || control.localName === 'select';
    if (!isCheckbox && !isMembership && !isRadio && !isSelect && !('value' in control)) {
      ctx.reject('sync-not-a-control');
      return;
    }
    let key = '';
    const event = isCheckbox || isMembership || isRadio || isSelect ? 'change' : 'input';

    /** The control's current selection as an array of value strings, whatever kind it is. */
    const selected = (): string[] =>
      Array.isArray(control.value)
        ? (control.value as string[]).map(String)
        : [...((control as unknown as HTMLSelectElement).selectedOptions ?? [])].map((o) => o.value);

    const write = () => {
      if (isCheckbox) ctx.set(key, control.checked);
      else if (isRadio) {
        if (control.checked) ctx.set(key, control.value);
      } else if (isMembership) {
        const current = ctx.get(key);
        const values = Array.isArray(current) ? current.map(String) : [];
        ctx.set(key, control.checked
          ? (values.includes(control.value) ? values : [...values, control.value])
          : values.filter((v) => v !== control.value));
      } else if (isMultiple) ctx.set(key, selected());
      else ctx.set(key, control.value);
    };
    el.addEventListener(event, write);
    return {
      apply: (_element: Element, value: unknown) => {
        key = String(value ?? '');
        const current = ctx.get(key);
        if (isCheckbox) control.checked = !!current;
        else if (isRadio) control.checked = String(current ?? '') === control.value;
        else if (isMembership) {
          control.checked = Array.isArray(current) && current.map(String).includes(control.value);
        } else if (isMultiple) {
          const values = Array.isArray(current) ? current.map(String) : [];
          if (Array.isArray(control.value)) (control as unknown as { value: string[] }).value = values;
          else for (const option of (control as unknown as HTMLSelectElement).options) {
            option.selected = values.includes(option.value);
          }
        } else control.value = current === null || current === undefined ? '' : String(current);
      },
      teardown: () => el.removeEventListener(event, write),
    };
  },
};

/**
 * `persist` — BOTH halves owned here so forgetting one is impossible (§10): setup restores, the
 * reflection saves. Storage failures (private mode) degrade to live-only with a note; keys are
 * author-global by design, prefixed `vd:`.
 */
const persist: Directive = {
  name: 'persist',
  value: 'literal',
  docs: { summary: 'Persists one state key to localStorage — restores on setup, saves on change.', example: 'data-vd-persist="theme"' },
  setup(_el, ctx) {
    let key = '';
    return {
      apply: (_element: Element, value: unknown) => {
        const next = String(value ?? '');
        if (next !== key) {
          key = next;
          try {
            const stored = localStorage.getItem(`vd:${key}`);
            if (stored !== null) ctx.set(key, JSON.parse(stored));
          } catch {
            ctx.reject('persist-unavailable');
            return;
          }
        }
        try {
          localStorage.setItem(`vd:${key}`, JSON.stringify(ctx.get(key)));
        } catch {
          /* saving best-effort; the restore note already told the story */
        }
      },
    };
  },
};

/* ── focus ───────────────────────────────────────────────────────────────────────────────── */

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]';
const focusables = (root: Element): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => !n.hasAttribute('disabled') && !(n as HTMLElement).hidden);

/** `focus-on` — focus follows STATE, so click, Escape and outside-click behave identically. */
const focusOn: Directive = {
  name: 'focus-on',
  value: 'expression',
  docs: { summary: 'Focuses the element (or its first focusable) when the expression turns truthy.', example: 'data-vd-focus-on="open"' },
  setup() {
    let was = false;
    return {
      apply: (el: Element, value: unknown) => {
        const now = !!value;
        if (now && !was) {
          const target = (el as HTMLElement).tabIndex >= 0 || focusables(el).length === 0 ? (el as HTMLElement) : focusables(el)[0];
          target.focus?.();
        }
        was = now;
      },
    };
  },
};

/** The trap STACK — nested modals: last trap wins, teardown restores the one before (§20 minor). */
const trapStack: Array<{ el: Element; before: HTMLElement | null }> = [];

const focusTrap: Directive = {
  name: 'focus-trap',
  value: 'none',
  docs: { summary: 'Traps Tab inside the element; teardown restores prior focus. Traps stack.', example: 'data-vd-focus-trap' },
  setup(el, ctx) {
    const items = () => focusables(el);
    if (items().length === 0) ctx.reject('focus-trap-empty');
    const before = (el.ownerDocument.activeElement as HTMLElement) ?? null;
    trapStack.push({ el, before });
    const onKey = (event: Event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'Tab') return;
      const list = items();
      if (list.length === 0) return;
      const active = el.ownerDocument.activeElement;
      const at = list.indexOf(active as HTMLElement);
      const next = (event as KeyboardEvent).shiftKey
        ? at <= 0 ? list[list.length - 1] : list[at - 1]
        : at === list.length - 1 ? list[0] : list[Math.max(at, 0) + 1];
      event.preventDefault();
      next.focus();
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      const idx = trapStack.findIndex((t) => t.el === el);
      if (idx !== -1) {
        const [popped] = trapStack.splice(idx, 1);
        /** Prefer a marked return target, else the element focused before the trap. */
        const marked = popped.before?.closest?.('[data-vd-focus-return]') ?? null;
        ((marked as HTMLElement) ?? popped.before)?.focus?.();
      }
    };
  },
};

/** `focus-return` is a MARKER the trap's teardown prefers — presence is the whole message. */
const focusReturn: Directive = {
  name: 'focus-return',
  value: 'none',
  docs: { summary: 'Marks the element focus should return to when a trap tears down.', example: 'data-vd-focus-return' },
};

/* ── page-level helpers ──────────────────────────────────────────────────────────────────── */

/** How many live elements are holding each document class — the `scroll-lock` discipline. */
const docClassHolders = new Map<string, number>();

const docClass: Directive = {
  name: 'doc-class',
  value: 'object',
  docs: { summary: 'Toggles classes on <html> from an object of name: expression.', example: 'data-vd-doc-class="{ no-scroll: open }"' },
  /**
   * REF-COUNTED and torn down, exactly as `scroll-lock` is — they are siblings that write to the
   * one document, and only one of them used to behave. A bare `apply` meant an element removed
   * while its class was on left `<html>` wearing it for the life of the page, and two elements
   * toggling one name fought with last-writer-wins. The count is per NAME, so the class comes off
   * when the last holder lets go and not before.
   */
  setup(el) {
    const held = new Set<string>();
    const release = (name: string) => {
      if (!held.delete(name)) return;
      const left = (docClassHolders.get(name) ?? 1) - 1;
      if (left > 0) docClassHolders.set(name, left);
      else {
        docClassHolders.delete(name);
        el.ownerDocument.documentElement.classList.remove(name);
      }
    };
    return {
      apply: (element: Element, value: unknown, context: Ctx) => {
        if (!isObject(value as never)) {
          context.reject('doc-class-not-object');
          return;
        }
        const entries = value as Record<string, unknown>;
        const root = element.ownerDocument.documentElement;
        for (const name of Object.keys(entries)) {
          const wanted = !!context.eval(entries[name]);
          if (wanted && !held.has(name)) {
            held.add(name);
            docClassHolders.set(name, (docClassHolders.get(name) ?? 0) + 1);
            root.classList.add(name);
          } else if (!wanted) {
            release(name);
          }
        }
      },
      teardown: () => {
        for (const name of [...held]) release(name);
      },
    };
  },
};

/** Ref-counted — two open drawers must not fight over one overflow style. */
let locks = 0;
const scrollLock: Directive = {
  name: 'scroll-lock',
  value: 'expression',
  docs: { summary: 'Locks page scroll while the expression is truthy. Locks stack.', example: 'data-vd-scroll-lock="open"' },
  setup(el) {
    let holding = false;
    const set = (on: boolean) => {
      if (on === holding) return;
      holding = on;
      locks += on ? 1 : -1;
      el.ownerDocument.documentElement.style.overflow = locks > 0 ? 'hidden' : '';
    };
    return {
      apply: (_element: Element, value: unknown) => {
        set(!!value);
      },
      teardown: () => set(false),
    };
  },
};

const copy: Directive = {
  name: 'copy',
  value: 'literal',
  docs: { summary: 'Copies the value (or the element text) to the clipboard on click.', example: 'data-vd-copy' },
  setup(el, ctx) {
    const onClick = () => {
      const textToCopy = el.getAttribute('data-vd-copy') || el.textContent || '';
      const clip = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
      if (!clip?.writeText) {
        ctx.reject('copy-unavailable');
        return;
      }
      clip.writeText(textToCopy).catch(() => ctx.reject('copy-refused'));
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  },
};

const scrollTo: Directive = {
  name: 'scroll-to',
  value: 'literal',
  docs: { summary: 'Scrolls to the selector target on click.', example: 'data-vd-scroll-to="#top"' },
  setup(el, ctx) {
    const onClick = () => {
      const target = el.ownerDocument.querySelector(String(el.getAttribute('data-vd-scroll-to') ?? ''));
      if (!target) {
        ctx.reject('scroll-to-missing');
        return;
      }
      (target as { scrollIntoView?: (o: object) => void }).scrollIntoView?.({ behavior: 'smooth' });
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  },
};

/* ── the event family, complete ──────────────────────────────────────────────────────────── */

const KEYED = new Set(['keydown', 'keyup']);
const SPECIAL = new Set(['outside-click', 'load', 'escape', 'submit', 'submit-native']);

/**
 * Suffix grammar (§6): `click` · `keydown-enter` · `window-scroll` · `document-keydown-escape` ·
 * the four specials an author cannot spell as listeners. Split by DECLARED bases, longest first —
 * nothing about `window-scroll` vs `keydown-enter`'s shape says which is which (the omniwp
 * subtlety, kept as a constraint).
 */
export const onFamilyFull = {
  match: (suffix: string): unknown | null => {
    if (!suffix.startsWith('on-')) return null;
    const rest = suffix.slice(3);
    if (SPECIAL.has(rest)) return { special: true, kind: rest };
    for (const target of ['window', 'document'])
      if (rest.startsWith(target + '-')) {
        const inner = rest.slice(target.length + 1);
        for (const keyed of KEYED)
          if (inner.startsWith(keyed + '-'))
            return { special: true, kind: 'target', target, type: keyed, key: inner.slice(keyed.length + 1) };
        return { special: true, kind: 'target', target, type: inner };
      }
    for (const keyed of KEYED) if (rest.startsWith(keyed + '-')) return { type: keyed, key: rest.slice(keyed.length + 1) };
    return { type: rest };
  },
};

const keyMatches = (event: KeyboardEvent, want: string | undefined): boolean => {
  if (!want) return true;
  const key = event.key === ' ' ? 'space' : event.key.length === 1 ? event.key.toLowerCase() : event.key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
  return key === want;
};

const on: Directive = {
  name: onFamilyFull,
  value: 'object',
  priority: 70,
  docs: { summary: 'Runs an assignments object when the event fires.', example: 'data-vd-on-click="{ open: !open }"' },
  setup(el, ctx) {
    const sel = ctx.selection as { special?: boolean; kind?: string; target?: string; type?: string; key?: string };
    if (!sel?.special) return;
    const attr = `data-vd-on-${sel.kind === 'target' ? `${sel.target}-${sel.type}${sel.key ? `-${sel.key}` : ''}` : sel.kind}`;
    const run = () => ctx.runAttr(attr);

    if (sel.kind === 'load') {
      /**
       * The element's OWN `load` event — an `<img>`, an `<iframe>`, a `<link>`. It is a special
       * rather than pure delegation because `load` does not bubble, so a root listener can never
       * see it.
       *
       * This used to mean "at activation", which put two meanings on one word: `on-window-load`
       * was the real event while `on-load` was the lifecycle, and `<img data-vd-on-load="{ ready:
       * true }">` — which every author writes expecting the image — silently fired before the
       * image had done anything. Activation is `data-vd-init` now, out of the event family
       * entirely, because activation is not an event.
       */
      el.addEventListener('load', run);
      return () => el.removeEventListener('load', run);
    }
    if (sel.kind === 'escape') {
      const onKey = (event: Event) => {
        if ((event as KeyboardEvent).key === 'Escape') run();
      };
      el.ownerDocument.addEventListener('keydown', onKey);
      return () => el.ownerDocument.removeEventListener('keydown', onKey);
    }
    if (sel.kind === 'outside-click') {
      /**
       * On the CONTAINER (the constraint set): a click composed-outside the element runs it.
       *
       * **Listened for in the CAPTURE phase, and that one argument is what makes the directive
       * usable at all.** The click that OPENS a panel is by construction a click outside it — the
       * button is not inside the thing it reveals — so in the bubble phase this saw the opening
       * click AFTER the delegated handler had already run and the reflection had already removed
       * `hidden`. It then closed the panel on the very click that opened it, and no amount of
       * "is it visible" testing could tell the two apart, because by then it genuinely was.
       *
       * Capture runs before any of that: the question becomes *was this element open when the click
       * began*, which is the question a reader means. The path test is phase-independent, so a click
       * genuinely outside still closes and a click inside still does not.
       */
      const onClick = (event: Event) => {
        /** A hidden panel has no outside — and in capture, "hidden" still means what it meant when
         *  the click started. `hidden` is the test because `show` sets exactly that, and because a
         *  layout test (`getClientRects`) is empty for everything under jsdom and would disable
         *  this wherever the suites run. */
        const node = el as HTMLElement;
        if (!node.isConnected || node.hidden) return;
        if (!event.composedPath().includes(el)) run();
      };
      el.ownerDocument.addEventListener('click', onClick, true);
      return () => el.ownerDocument.removeEventListener('click', onClick, true);
    }
    if (sel.kind === 'submit' || sel.kind === 'submit-native') {
      const native = sel.kind === 'submit-native';
      const onSubmit = (event: Event) => {
        /** Prevent by default; `-native` is the day-one opt-out, a MEMBER because it selects (§20.7). */
        if (!native) event.preventDefault();
        run();
      };
      el.addEventListener('submit', onSubmit);
      return () => el.removeEventListener('submit', onSubmit);
    }
    if (sel.kind === 'target') {
      const target: EventTarget = sel.target === 'window' ? el.ownerDocument.defaultView! : el.ownerDocument;
      const onEvent = (event: Event) => {
        if (KEYED.has(sel.type!) && !keyMatches(event as KeyboardEvent, sel.key)) return;
        run();
      };
      target.addEventListener(sel.type!, onEvent);
      return () => target.removeEventListener(sel.type!, onEvent);
    }
    return undefined;
  },
};

export { onFamilyFull as onFamily };

/**
 * `state` is not in this list — it is ENGINE-OWNED and always registered (the context layer is
 * the engine's, not a pack's). That absence is also what keeps this module importing nothing
 * from the engine, which is what makes the additive single-file build possible at all.
 */
export const interactions: Directive[] = [
  show, classDirective, style, text, bind, init, every, watch, sync, persist,
  focusOn, focusTrap, focusReturn, docClass, scrollLock, copy, scrollTo, on,
];
