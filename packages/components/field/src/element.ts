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
import { effect } from '@verajs/core';
import { announce } from '@vera-hooks/announce';
import { labeled } from '@vera-hooks/labeled';
import type { LabeledWiring } from '@vera-hooks/labeled';
import { choose } from './field/choose.js';
import type { ErrorPart, Validity } from './field/choose.js';
import { step } from './field/count.js';
import type { Spoken } from './field/count.js';

/** The tag and the element's declared options, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-field' } as const;

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
};

/**
 * **One mark per COPY of this library**, a private `Symbol()` (never `Symbol.for`): each copy's handler acts only on
 * the fields its own copy defined, so two copies on one page never handle one event twice.
 */
const MARK = Symbol('vera-field');
type Marked = Element & { [MARK]?: Wired };
/** On a root: how many of this copy's fields are connected in it, so the last one to leave removes the listeners. */
type Root = Node & { [MARK]?: number };
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
  const choice = wired.tried ? choose(validityOf(wired.control), partsOf(wired.errors)) : null;
  wired.errors.forEach((error, index) => {
    const shown = choice !== null && choice.index === index;
    /** The user's own words (and markup) are never touched; only a part they left empty takes the browser's text. */
    if ((error as Error_)[TEXT] === '') error.textContent = shown ? choice.text : '';
    error.toggleAttribute('hidden', !shown);
  });
  wired.wiring.show(choice === null ? null : wired.errors[choice.index]);
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
  /** Keyed by the count part's own id (labeled gives it one to reference), so two fields never collapse into one. */
  if (next.say !== null) announce(field, next.say.left === 0 ? 'Limit reached' : `${next.say.left} characters left`, { key: wired.count.id });
};

/** The field (of this copy) an event belongs to: the nearest `vera-field` around its target that carries our mark. */
const fieldOf = (event: Event): [Marked, Wired] | null => {
  const target = event.target as Element | null;
  const field = target !== null && typeof target.closest === 'function' ? (target.closest('vera-field') as Marked | null) : null;
  const wired = field?.[MARK];
  return field && wired && wired.control.contains(target as Node) ? [field, wired] : null;
};

const onInput = (event: Event): void => {
  const found = fieldOf(event);
  if (found === null) return;
  const [field, wired] = found;
  wired.edited = true;
  const composing = (event as InputEvent).isComposing === true;
  counted(field, wired, !composing);
  if (wired.tried) render(wired);
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
const onInvalid = (event: Event): void => {
  const found = fieldOf(event);
  if (found === null) return;
  if (!found[0].hasAttribute('native-messages')) event.preventDefault();
  found[1].tried = true;
  render(found[1]);
};
const onReset = (event: Event): void => {
  const form = event.target as Element | null;
  if (form === null || typeof form.querySelectorAll !== 'function') return;
  for (const field of form.querySelectorAll('vera-field') as NodeListOf<Marked>) {
    const wired = field[MARK];
    if (wired === undefined) continue;
    wired.tried = false;
    wired.edited = false;
    render(wired);
  }
};

/** The listeners, in the phase each event needs: `invalid` does not bubble, `input` and `reset` are read in capture. */
const LISTENERS: [string, (event: Event) => void, boolean][] = [
  ['input', onInput, true],
  ['compositionend', onCompositionEnd, true],
  ['focusout', onFocusOut, false],
  ['invalid', onInvalid, true],
  ['reset', onReset, true],
];

const listen = (root: Root): void => {
  const n = root[MARK] ?? 0;
  if (n === 0) for (const [type, fn, capture] of LISTENERS) root.addEventListener(type, fn, capture);
  root[MARK] = n + 1;
};
const unlisten = (root: Root): void => {
  const n = (root[MARK] ?? 1) - 1;
  if (n === 0) for (const [type, fn, capture] of LISTENERS) root.removeEventListener(type, fn, capture);
  root[MARK] = n;
};

/** Wires the field's current control and parts; the user's error text is kept to restore and to show. */
const wire = (field: Marked, control: Element): Wired => {
  const errors = [...field.querySelectorAll('[data-vera-part="error"]')];
  for (const error of errors) (error as Error_)[TEXT] ??= (error.textContent ?? '').trim();
  const label = field.querySelector('label');
  const hint = part(field, 'hint');
  const count = part(field, 'count');
  const wiring = labeled(control, { host: field, label, hint, count, errors });
  const wired: Wired = { control, label, hint, count, errors, wiring, tried: false, edited: false, spoken: 0 };
  render(wired);
  counted(field, wired, false);
  return wired;
};

/**
 * The setup: no render (the field's children are the user's). An effect wires on connect and releases on removal; a
 * move to another window re-runs it there. A control the page swaps (a framework re-render) is caught as it happens,
 * by an observer of the control's parent only, so text changes in the field's other parts never wake it.
 */
export const setup = (host: HTMLElement) => {
  const field = host as Marked;
  effect(() => {
    const control = findControl(field);
    if (control === null) return;
    const root = field.getRootNode();
    let wired = (field[MARK] = wire(field, control));
    listen(root);
    const observer = new MutationObserver(() => {
      const now = findControl(field);
      if (now === wired.control) return;
      wired.wiring.release();
      if (now === null) return;
      wired = field[MARK] = wire(field, now);
      observer.disconnect();
      observer.observe(now.parentNode as Node, { childList: true });
    });
    observer.observe(control.parentNode as Node, { childList: true });
    return () => {
      observer.disconnect();
      wired.wiring.release();
      delete field[MARK];
      unlisten(root);
    };
  });
};
