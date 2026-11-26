/**
 * **<vera-checkbox> and <vera-switch>: their options and their setup.** Never calls `define`: `register.ts` does, so
 * importing the `./element` entry registers nothing.
 *
 * The control is the author's own `<input type="checkbox">`, read where it is and never moved, and REQUIRED: there is no
 * default render, because a control the script made would be no control before the script runs. So the input stays the
 * form participant (submit, reset, `<fieldset disabled>`, autofill, back/forward restore are the platform's), and the
 * author's label (a wrapping `<label>`, a `<label for>`, `<vera-field>`) names it. The element writes only marks onto
 * the input, and the look is drawn on the input itself; a switch is the same input with the switch semantics added.
 */
import { effect, isServer } from '@verajs/core';
import { adoptOwnSheet, diagnostic, labelName } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { CHECKBOX_LOOK, CHECKBOX_SHEET, SWITCH_LOOK, SWITCH_SHEET } from './checkbox/sheet.js';

/** `<vera-checkbox>`'s tag and declared attributes, handed to core's `define` by `register.ts`. */
export const checkboxOptions = {
  tag: 'vera-checkbox',
  attributes: ['indeterminate'],
  /** Nothing is rendered: the input, its label and everything around them are the author's, so light slots never park them. */
  ownsChildren: true,
} as const;

/** `<vera-switch>`'s: the same, without a mixed state (a switch is on or off), so it declares no attribute. */
export const switchOptions = {
  tag: 'vera-switch',
  ownsChildren: true,
} as const;

/** What `define` hands the setup: the element, with its declared attributes as props. */
interface CheckboxHost extends HTMLElement {
  indeterminate?: string | null;
}

type Kind = 'checkbox' | 'switch';

/**
 * **The input served: the first `<input>` of type checkbox in the host, in tree order, not inside another custom
 * element** (a component written inside is that component's).
 */
const controlOf = (host: Element): HTMLInputElement | null => {
  for (const input of host.querySelectorAll('input')) {
    if (input.type !== 'checkbox') continue;
    let nested = false;
    for (let at = input.parentElement; at !== null && at !== host; at = at.parentElement)
      if (at.localName.includes('-')) {
        nested = true;
        break;
      }
    if (!nested) return input;
  }
  return null;
};

/** What the element serves now: a plain holder, read by the mixed listener and the development check at their time. */
type Served = {
  input: HTMLInputElement | null;
  release: (() => void) | undefined;
  timer: number | undefined;
};

/**
 * **The current input, kept true while connected** (input's way): while none is served, one observer of the host's
 * whole subtree, since the input may arrive anywhere inside (a renderer appends a label, then the input into it); once
 * found, only its parent chain up to the host, childList only, so the label's own text changing never wakes it. An
 * input whose `type` the page changes in place, to or from checkbox, is not re-served: the type is read when the input
 * is found (as `<vera-input>` reads its own), so swap the element instead. Each input found is served by `serve` and
 * the one before released first, with no signal between: the tracking serves directly. Returns the release.
 */
const tracking = (host: CheckboxHost, served: Served, serve: (input: HTMLInputElement) => () => void): (() => void) | undefined => {
  const win = host.ownerDocument.defaultView;
  if (win === null) return undefined;
  const observer = new win.MutationObserver(() => track(false));
  const track = (first: boolean): void => {
    const input = controlOf(host);
    const changed = input !== served.input;
    if (changed) {
      served.release?.();
      served.input = input;
      served.release = input === null ? undefined : serve(input);
    }
    /** Development: checked a task after it settles, so a `<vera-field>` around it (which labels the input in its own effect) has run. */
    if (__DEV__ && (first || changed)) {
      win.clearTimeout(served.timer);
      served.timer = win.setTimeout(() => {
        served.timer = undefined;
        warn(host, served.input);
      }, 0);
    }
    observer.disconnect();
    if (input === null) {
      observer.observe(host, { childList: true, subtree: true });
      return;
    }
    for (let at = input.parentNode; at !== null; at = at.parentNode) {
      observer.observe(at, { childList: true });
      if (at === host) break;
    }
  };
  track(true);
  return () => {
    observer.disconnect();
    if (__DEV__) win.clearTimeout(served.timer);
    served.timer = undefined;
    served.release?.();
    served.input = null;
    served.release = undefined;
  };
};

/** An attribute written onto the author's input for as long as it is served, then put back to what it was. */
const writes = (input: HTMLInputElement, name: string, value: string): (() => void) => {
  const before = input.getAttribute(name);
  input.setAttribute(name, value);
  return () => {
    if (before === null) input.removeAttribute(name);
    else input.setAttribute(name, before);
  };
};

/**
 * **The marks, on the served input; released to what the author wrote.** The look keys on the mark (`data-vera-checkbox`
 * or `data-vera-switch`), and the host's look opt-out reaches the input, so every rule keys on the input alone; an
 * opt-out the author wrote on the input is theirs. A switch takes the platform's `switch` where the engine has it
 * (feature-detected on the input, never assumed) and `role="switch"` only where it does not, so it is never both; a
 * `role` the author wrote is left as theirs.
 */
const marking = (input: HTMLInputElement, kind: Kind, look: string | null): (() => void) => {
  const releases = [writes(input, `data-vera-${kind}`, '')];
  if (look !== null && !input.hasAttribute('data-vera-look')) releases.push(writes(input, 'data-vera-look', look));
  if (kind === 'switch')
    if ('switch' in input) {
      if (!input.hasAttribute('switch')) releases.push(writes(input, 'switch', ''));
    } else if (!input.hasAttribute('role')) releases.push(writes(input, 'role', 'switch'));
  return () => {
    for (const release of releases) release();
  };
};

/**
 * **Mixed: the host's `indeterminate` attribute and the input's `indeterminate` property never disagree once a click
 * has settled.** The attribute sets the property (there is no `indeterminate` attribute on an input). A click on a
 * mixed box is the platform's: it clears `indeterminate` and flips `checked` before any listener runs, and restores
 * both after dispatch when a listener canceled it. So the attribute is taken off on the input's own `input` event,
 * which fires only for a click that was not canceled, after that restore was decided; a canceled click fires none
 * and leaves both as they were. What mixed means next is the app's. One capture listener on the host, added once in
 * the setup, reads the input served at the event: no effect per input (each effect measured a few ms per 200 elements).
 */
const mixing = (host: CheckboxHost, served: Served): void => {
  host.addEventListener(
    'input',
    (event) => {
      const input = served.input;
      if (event.target === input && input !== null && !input.indeterminate) host.removeAttribute('indeterminate');
    },
    true,
  );
};

/**
 * **Serving one input: its marks and, on a checkbox, its mixed state.** The host's attribute is the source of mixed: it
 * sets the property, and the release clears it, so an input the page swaps out or moves away keeps no dash. Written
 * only when it differs: almost no box is mixed.
 */
const serve = (input: HTMLInputElement, kind: Kind, look: string | null, mixed: boolean): (() => void) => {
  const release = marking(input, kind, look);
  if (!mixed && !input.indeterminate) return release;
  input.indeterminate = mixed;
  return () => {
    release();
    if (mixed) input.indeterminate = false;
  };
};

/** Development: the warnings this host and its input call for. Each code is named literally at its call. */
const warn = (host: CheckboxHost, input: HTMLInputElement | null): void => {
  const subject = `<${host.localName}>`;
  if (input === null) console.warn(diagnostic('checkbox', subject, 'checkbox-no-control', __DEV__ && PROSE['checkbox-no-control']()));
  else if (labelName(input) === '') console.warn(diagnostic('checkbox', subject, 'checkbox-no-name', __DEV__ && PROSE['checkbox-no-name']()));
};

/**
 * **The setup, for either tag: no render (the children are the author's).** ONE effect, before paint: it adopts the
 * look into the host's root (one sheet per tag, so a checkbox page carries no switch rule), reads the two attributes
 * the serving depends on, and tracks the input, serving each one found and releasing the one before, so an input the
 * page swaps (a framework re-render) is served and the old one is as written. A change of either attribute re-runs it.
 * One effect, not one per concern: each effect and signal is a cost every element's creation pays (ablation, Chromium,
 * 200 elements, a settled page: five effects and a signal read 1.36 times core's floor, one effect lower).
 */
const serving = (kind: Kind) => (host: CheckboxHost) => {
  if (isServer()) return undefined;
  const served: Served = { input: null, release: undefined, timer: undefined };
  effect(
    () => {
      if (kind === 'switch') adoptOwnSheet(host, SWITCH_SHEET, SWITCH_LOOK);
      else adoptOwnSheet(host, CHECKBOX_SHEET, CHECKBOX_LOOK);
      /**
       * The look opt-out, read when the input is served rather than declared: a declared attribute is a reactive prop
       * every element's creation builds, and this one cost about 4 ms per 200 on WebKit (ablation). An opt-out is
       * written with the markup; to change it later, set it on the input, which the look reads itself.
       */
      const look = host.getAttribute('data-vera-look');
      const mixed = kind === 'checkbox' && host.indeterminate != null;
      return tracking(host, served, (input) => serve(input, kind, look, mixed));
    },
    { timing: 'layout' },
  );
  if (kind === 'checkbox') mixing(host, served);
  return undefined;
};

export const checkboxSetup = serving('checkbox');
export const switchSetup = serving('switch');
