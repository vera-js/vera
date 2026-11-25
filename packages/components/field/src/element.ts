/**
 * **<vera-field>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * The field renders nothing of its own. Its children are the user's (a `<label>`, one control, and the parts
 * `[data-vera-part="hint|error|count"]`), read where they are and never moved; the field wires them through
 * `@vera-hooks/labeled`, shows the error the control's validity calls for after the user has tried, and keeps the
 * count's text. Its listeners are delegated per ROOT (the document, or a user's shadow root), one handler per copy of
 * this library, so a page of a thousand fields has one set of listeners per root, not per field.
 */
import { effect, isServer } from '@verajs/core';
import { adoptOwnSheet, diagnostic, quoted } from '@verajs/shared-utils';
import { announce } from '@vera-hooks/announce';
import { labeled } from '@vera-hooks/labeled';
import type { LabeledWiring } from '@vera-hooks/labeled';
import { PROSE } from './diagnostics.js';
import { choose, VALIDITY_KEYS } from './field/choose.js';
import type { ErrorPart, Validity } from './field/choose.js';
import { LOOK, SHEET } from './field/sheet.js';
import { step } from './field/count.js';
import type { Spoken } from './field/count.js';

/** The tag and the element's declared options, handed to core's `define` by `register.ts`, and ownsChildren: its children are the author's (a label, a control, hints and errors), so a page wiring light-DOM slots must not park them. */
export const options = { tag: 'vera-field', ownsChildren: true } as const;

/** The elements a `label[for]` can name; any other control is named through `aria-labelledby` (labeled decides). */
const LABELABLE = 'input:not([type="hidden"]),select,textarea,button,meter,output,progress';

/** What a field holds while connected: its parts, its wiring, and its count and error state. */
type Wired = {
  control: Element;
  label: Element | null;
  hint: Element | null;
  count: Element | null;
  errors: Element[];
  wiring: LabeledWiring;
  /** True once the user has tried the control (a blur after an edit, or a submit): errors show only from then. */
  tried: boolean;
  edited: boolean;
  spoken: Spoken;
  /**
   * The error a server rejected the value with ("That email is taken": a part `data-when="server"`, or a shown part
   * on a control the server marked `aria-invalid="true"`): it stands until the user's first edit, so loading the
   * script never hides it; then the ordinary rules apply. A plain authored error part is not one: authors write error
   * parts without `hidden`, so only an explicit server signal says the value was judged.
   */
  standing: Element | null;
};

/**
 * **One mark per COPY of this library**, a private `Symbol()` (never `Symbol.for`): each copy's handler acts only on
 * the fields its own copy defined, so two copies on one page never handle one event twice.
 */
const MARK = Symbol('vera-field');
type Marked = Element & { [MARK]?: Wired };
/**
 * On a root: how many of this copy's fields are connected in it, so the last one to leave removes the listeners. Its
 * own symbol: under MARK, the walk from a target up to the document would read the count as a field.
 */
const COUNT = Symbol('vera-field-roots');
type Root = Node & { [COUNT]?: number };
/** On an error part: the text the user wrote in it, read once, so a part they left empty can show the browser's. */
const TEXT = Symbol('vera-field-text');
type Error_ = Element & { [TEXT]?: string };

/** The control: the field's `[data-vera-part="control"]`, else its first labelable descendant. */
const findControl = (field: Element): Element | null =>
  field.querySelector('[data-vera-part="control"]') ?? field.querySelector(LABELABLE);

const part = (field: Element, name: string): Element | null => field.querySelector(`[data-vera-part="${name}"]`);

/** The control's validity as the chooser reads it; a control with none (a `button`) is always valid. */
const validityOf = (control: Element): Validity => {
  const c = control as Partial<{ validity: ValidityState; validationMessage: string }>;
  if (c.validity === undefined) return { valid: true, validationMessage: '' };
  const v = c.validity;
  return {
    valid: v.valid,
    validationMessage: c.validationMessage ?? '',
    badInput: v.badInput,
    customError: v.customError,
    patternMismatch: v.patternMismatch,
    rangeOverflow: v.rangeOverflow,
    rangeUnderflow: v.rangeUnderflow,
    stepMismatch: v.stepMismatch,
    tooLong: v.tooLong,
    tooShort: v.tooShort,
    typeMismatch: v.typeMismatch,
    valueMissing: v.valueMissing,
  };
};

/** The error parts as the chooser sees them: each `data-when`, and its own text as the user wrote it. */
const partsOf = (errors: readonly Element[]): ErrorPart[] =>
  errors.map((error) => ({ when: error.getAttribute('data-when'), text: (error as Error_)[TEXT] ?? '' }));

/** Shows the error the control's validity calls for (or none), each part's `hidden` and the wiring's description. */
const render = (wired: Wired): void => {
  if (wired.standing !== null) {
    for (const error of wired.errors) error.toggleAttribute('hidden', error !== wired.standing);
    wired.wiring.show(wired.standing);
    return;
  }
  const choice = wired.tried ? choose(validityOf(wired.control), partsOf(wired.errors)) : null;
  wired.errors.forEach((error, index) => {
    const shown = choice !== null && choice.index === index;
    /** The user's own words (and markup) are never touched; only a part they left empty takes the browser's text. */
    if ((error as Error_)[TEXT] === '') error.textContent = shown ? choice.text : '';
    error.toggleAttribute('hidden', !shown);
  });
  wired.wiring.show(choice === null ? null : wired.errors[choice.index]);
};

/**
 * The plural category of `n` in the field's language: the closest `lang`, else the browser's default. A `lang` that
 * is no valid language tag (`Intl` throws a RangeError) is read as the default, as an unknown language is.
 */
const plural = (field: Element, n: number): string => {
  const lang = field.closest('[lang]')?.getAttribute('lang') || undefined;
  let rules: Intl.PluralRules;
  try {
    rules = new Intl.PluralRules(lang);
  } catch {
    rules = new Intl.PluralRules();
  }
  return rules.select(n);
};

/** The count's text, and its announcement at a crossing: only for the user's committed input. */
const counted = (field: Element, wired: Wired, committed: boolean): void => {
  const max = Number((wired.control as Element & { maxLength?: number }).maxLength ?? -1);
  if (wired.count === null || !(max > 0)) return;
  const length = String((wired.control as Element & { value?: unknown }).value ?? '').length;
  wired.count.textContent = `${length} / ${max}`;
  if (!committed) return;
  const next = step(wired.spoken, length, max);
  wired.spoken = next.spoken;
  if (next.say === null) return;
  /**
   * The words are the consumer's, `{left}` interpolated: `limit-message` at the limit; otherwise
   * `count-message-<category>` for the plural category of `left` in the field's language (the closest `lang`, through
   * `Intl.PluralRules`: one, two, few, many, other, zero, so every language's forms fit), then `count-message`, then
   * English ("1 character left", "8 characters left").
   */
  const left = next.say.left;
  const text =
    left === 0
      ? (field.getAttribute('limit-message') ?? 'Limit reached')
      : (field.getAttribute(`count-message-${plural(field, left)}`) ?? field.getAttribute('count-message') ?? (left === 1 ? '{left} character left' : '{left} characters left')).replaceAll('{left}', String(left));
  /** Keyed by the count part's own id (labeled gives it one to reference), so two fields never collapse into one. */
  announce(field, text, { key: wired.count.id });
};

/**
 * The field (of this copy) a node belongs to: the nearest ancestor carrying our MARK, whose control holds the node.
 * Found by the mark, never by the tag: `./element`'s `defineAs` registers the field under the user's own tag.
 */
const markedAround = (node: Node | null): [Marked, Wired] | null => {
  for (let at = node; at !== null; at = at.parentNode) {
    const wired = (at as Marked)[MARK];
    if (wired !== undefined) return wired.control.contains(node) ? [at as Marked, wired] : null;
  }
  return null;
};
const fieldOf = (event: Event): [Marked, Wired] | null => markedAround(event.target as Node | null);

const onInput = (event: Event): void => {
  const found = fieldOf(event);
  if (found === null) return;
  const [field, wired] = found;
  wired.edited = true;
  /** The user's first edit ends a server's standing error: render once so it is hidden even before they have tried. */
  const stood = wired.standing !== null;
  wired.standing = null;
  const composing = (event as InputEvent).isComposing === true;
  counted(field, wired, !composing);
  if (wired.tried || stood) render(wired);
};
const onCompositionEnd = (event: Event): void => {
  const found = fieldOf(event);
  if (found !== null) counted(found[0], found[1], true);
};
const onFocusOut = (event: Event): void => {
  const found = fieldOf(event);
  if (found === null || !found[1].edited) return;
  found[1].tried = true;
  render(found[1]);
};
/**
 * On a form: the user attempted to submit it in this task (a submit control clicked, or Enter in a control that submits
 * implicitly), and whether its focus decision is queued. `invalid` carries no flag telling interactive validation from
 * `checkValidity()`, the silent check apps call on every keystroke, so the field must see the ATTEMPT itself: focus
 * moves only for a form the user tried to submit. Cost, stated: a scripted `reportValidity()` or `requestSubmit()`
 * is not seen, and the browser focuses nothing for a field's canceled control then (the app focuses for itself).
 */
const ATTEMPT = Symbol('vera-field-attempt');
/**
 * The attempt: the event that made it (a canceled one submits nothing, so moves no focus), whether its focus is queued,
 * and who reports it: the field whose control is its first invalid, or the browser (a bare control, or a field with
 * `native-messages`, came first).
 */
type Form = HTMLFormElement & { [ATTEMPT]?: { event: Event; queued: boolean; reports?: 'field' | 'native' } };

/**
 * **Focus after a failed submit, decided per FORM, in tree order.** A field cancels its own control's `invalid` (no
 * native bubble), and once it does the browser focuses nothing for that control, so the first queued call focuses the
 * form's first invalid control in TREE order, over every control, a bare native input included: native behavior is
 * "the first invalid in tree order", which canceling would otherwise break (the browser alone would focus the next
 * uncanceled one). Native reports ONE invalid per submit, the first: so once a field reports the attempt, every later
 * `invalid` in that form is canceled too, a bare control's included, and no bubble shows past the field's error. Cost,
 * stated: an app reading a later bare control's `invalid.defaultPrevented` sees true. When a bare control is first,
 * the browser reports it as native does, and fields cancel only their own.
 */
const focusFirstInvalid = (form: Form): void => {
  const attempt = form[ATTEMPT];
  /** Read when `invalid` fires, after every listener of the click or the Enter has run: an app may have canceled it. */
  if (attempt === undefined || attempt.queued || attempt.event.defaultPrevented) return;
  attempt.queued = true;
  /**
   * A task, not a microtask: under a user's submit the checkpoint runs after each `invalid` listener, before the rest
   * fire, and then the browser focuses the first control whose `invalid` nobody canceled (Chromium and WebKit move
   * focus past the field to a later plain control). A task runs after the browser's own focus, so tree order wins.
   */
  (form.ownerDocument.defaultView ?? globalThis).setTimeout(() => {
    /**
     * The first in tree order. One that cannot take focus (`display: none`) makes `focus()` a no-op and nothing is
     * focused: the same as native validation's "not focusable", so the loop stops there either way.
     */
    for (const control of form.elements as unknown as Iterable<Element & { willValidate?: boolean; validity?: ValidityState; focus?: () => void }>)
      if (control.willValidate === true && control.validity !== undefined && !control.validity.valid) {
        control.focus?.();
        return;
      }
  }, 0);
};

/** The form a user's submit attempt is for: a submit control's form owner (`form=` included), read through `.form`. */
const attempted = (form: HTMLFormElement | null | undefined, event: Event): void => {
  if (!form) return;
  const marked = form as Form;
  if (marked[ATTEMPT] !== undefined) return;
  marked[ATTEMPT] = { event, queued: false };
  /** Cleared a task later, so a later silent `checkValidity()` on the same form moves no focus. */
  (form.ownerDocument.defaultView ?? globalThis).setTimeout(() => delete marked[ATTEMPT], 0);
};
const onClick = (event: Event): void => {
  const target = event.target as Element | null;
  const submit = target !== null && typeof target.closest === 'function' ? target.closest('button,input') : null;
  const type = (submit as (Element & { type?: string }) | null)?.type;
  if (type === 'submit' || type === 'image') attempted((submit as Element & { form?: HTMLFormElement | null }).form, event);
};
/** The input types from which Enter submits a form (HTML's implicit submission). */
const IMPLICIT = /^(?:text|search|url|tel|email|password|number|date|month|week|time|datetime-local)$/;
const onKeydown = (event: Event): void => {
  const key = event as KeyboardEvent;
  /** An Enter while composing (an IME) confirms a candidate; it submits nothing. 229 is the composing keyCode. */
  if (key.key !== 'Enter' || key.isComposing || key.keyCode === 229) return;
  const target = event.target as (Element & { form?: HTMLFormElement | null; type?: string }) | null;
  /**
   * Enter submits implicitly only from the text-like input types (never a textarea, where it is a newline); on a
   * submit or image button it arrives as a click.
   */
  if (target !== null && target.localName === 'input' && IMPLICIT.test(target.type ?? '')) attempted(target.form, event);
};

const onInvalid = (event: Event): void => {
  const found = fieldOf(event);
  const control = (found === null ? event.target : found[1].control) as (Element & { form?: HTMLFormElement | null }) | null;
  const form = (control?.form ?? null) as Form | null;
  const attempt = form?.[ATTEMPT];
  const live = attempt !== undefined && !attempt.event.defaultPrevented ? attempt : null;
  const native = found === null || found[0].hasAttribute('native-messages');
  if (live !== null && live.reports === undefined) live.reports = native ? 'native' : 'field';
  if (!native || live?.reports === 'field') event.preventDefault();
  if (found === null) return;
  found[1].tried = true;
  render(found[1]);
  if (form) focusFirstInvalid(form);
};
/**
 * A reset forgets that the user tried, by the form's own controls (so a control joined from outside with `form=`
 * counts, and a field under any tag is found by its mark). The `reset` event fires BEFORE the form restores values,
 * and after a user's reset Chromium and WebKit still run the microtask before the restore (Firefox restores first),
 * so the count is re-read a task later, which sees the restored value on all three; what the
 * count has spoken is left as it is (only committed input judges it).
 */
const onReset = (event: Event): void => {
  const form = event.target as (Element & { elements?: Iterable<Element> }) | null;
  if (form === null || form.elements === undefined) return;
  const fields: [Marked, Wired][] = [];
  for (const control of form.elements) {
    const found = markedAround(control);
    if (found === null || found[1].control !== control) continue;
    found[1].tried = false;
    found[1].edited = false;
    found[1].standing = null;
    render(found[1]);
    fields.push(found);
  }
  if (fields.length > 0)
    (form.ownerDocument.defaultView ?? globalThis).setTimeout(() => {
      for (const [field, wired] of fields) if (field[MARK] === wired) counted(field, wired, false);
    }, 0);
};

/** The listeners, in the phase each event needs: `invalid` does not bubble, `input` and `reset` are read in capture. */
const LISTENERS: [string, (event: Event) => void, boolean][] = [
  ['input', onInput, true],
  ['compositionend', onCompositionEnd, true],
  ['focusout', onFocusOut, false],
  ['invalid', onInvalid, true],
  ['reset', onReset, true],
  ['click', onClick, true],
  ['keydown', onKeydown, true],
];

const listen = (root: Root): void => {
  const n = root[COUNT] ?? 0;
  if (n === 0) for (const [type, fn, capture] of LISTENERS) root.addEventListener(type, fn, capture);
  root[COUNT] = n + 1;
};
const unlisten = (root: Root): void => {
  const n = (root[COUNT] ?? 1) - 1;
  if (n === 0) for (const [type, fn, capture] of LISTENERS) root.removeEventListener(type, fn, capture);
  root[COUNT] = n;
};

/**
 * Development only: an error part whose `data-when` no ValidityState key (nor "server") matches, which is never
 * shown. A control nothing names is labeled's own warning (`labeled-unnamed`), so the field adds none.
 */
const warnings = (field: Element, errors: readonly Element[]): void => {
  for (const error of errors) {
    const when = error.getAttribute('data-when');
    if (when !== null && when !== 'server' && !(VALIDITY_KEYS as readonly string[]).includes(when))
      console.warn(diagnostic('field', `<${field.localName}>`, 'field-unknown-when', __DEV__ && PROSE['field-unknown-when'](quoted(when), VALIDITY_KEYS.join(', '))));
  }
};

/** Wires the field's current control and parts; the user's error text is kept to restore and to show. */
const wire = (field: Marked, control: Element): Wired => {
  const errors = [...field.querySelectorAll('[data-vera-part="error"]')];
  for (const error of errors) (error as Error_)[TEXT] ??= (error.textContent ?? '').trim();
  const label = field.querySelector('label');
  const hint = part(field, 'hint');
  const count = part(field, 'count');
  if (__DEV__ && typeof console !== 'undefined') warnings(field, errors);
  const wiring = labeled(control, { host: field, label, hint, count, errors });
  /**
   * A standing error is said on the PART, because only the part knows its text came from a server:
   * `data-when="server"` with text. Plain server templates often never set `aria-invalid`, so that is a second
   * signal only: on a control served `aria-invalid="true"`, a shown part with text and no `data-when` stands too.
   */
  const judged = control.getAttribute('aria-invalid') === 'true';
  const said = (error: Element) => !error.hasAttribute('hidden') && (error as Error_)[TEXT] !== '';
  const standing =
    errors.find((error) => error.getAttribute('data-when') === 'server' && said(error)) ??
    (judged ? (errors.find((error) => !error.hasAttribute('data-when') && said(error)) ?? null) : null);
  const wired: Wired = { control, label, hint, count, errors, wiring, tried: false, edited: false, spoken: 0, standing };
  render(wired);
  counted(field, wired, false);
  return wired;
};

/**
 * The setup: no render (the field's children are the user's). An effect wires on connect and releases on removal; a
 * move to another window re-runs it there. A control the page swaps (a framework re-render, of the control or of a
 * wrapper around it) is caught as it happens by an observer of each ancestor from the control's parent up to the field,
 * childList only, so text changes in the field's other parts never wake it. With no control (removed, or not yet
 * there), the field holds no wiring and watches its whole subtree until one appears.
 */
export const setup = (host: HTMLElement) => {
  const field = host as Marked;
  /** The look's mark (its rules key on it, never on the tag), and the look itself, adopted into the root as a layout effect. */
  host.setAttribute('data-vera-field', '');
  if (!isServer()) effect(() => adoptOwnSheet(host, SHEET, LOOK), { timing: 'layout' });
  effect(() => {
    const root = field.getRootNode();
    listen(root);
    let wired: Wired | null = null;
    const observer = new MutationObserver(() => track(findControl(field)));
    const watch = (control: Element | null): void => {
      observer.disconnect();
      if (control === null) {
        observer.observe(field, { childList: true, subtree: true });
        return;
      }
      /** The parent is never null here: the control was found inside the field, so the chain ends at the field. */
      for (let at = control.parentNode; at !== null; at = at.parentNode) {
        observer.observe(at, { childList: true });
        if (at === field) break;
      }
    };
    const track = (control: Element | null): void => {
      if (wired !== null && control === wired.control) return;
      if (wired !== null) {
        wired.wiring.release();
        delete field[MARK];
        wired = null;
      }
      if (control !== null) wired = field[MARK] = wire(field, control);
      watch(control);
    };
    track(findControl(field));
    return () => {
      observer.disconnect();
      if (wired !== null) wired.wiring.release();
      delete field[MARK];
      unlisten(root);
    };
  });
};
