/**
 * **<vera-input>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * The input is the user's own `<input>`, read where it is and never moved: it is the form participant, so autofill,
 * validity, reset, `<fieldset disabled>` and bfcache stay the platform's. Only when the user wrote no input does the
 * element render one (`[data-vera-part="input"]`, server-side too), from the host's listed attributes read ONCE. The
 * parts it adds (clear, the loading mark) are its own, written beside the input after render, so a render never owns
 * the user's children.
 */
import { effect, html, isServer, signal, untrack } from '@verajs/core';
import { adoptOwnSheet, diagnostic, quoted } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { clearShown, COPIED, copiedFrom, escapeClears, warnings } from './input/decide.js';
import type { ClearState } from './input/decide.js';
import { capsHint } from './input/caps.js';
import { revealing } from './input/reveal.js';
import { LOOK, SHEET } from './input/sheet.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = {
  tag: 'vera-input',
  attributes: ['clearable', 'clear-label', 'loading', 'reveal', 'reveal-label', 'caps-lock-hint', 'caps-lock-message'],
  /** The parts written beside the input are this element's own, never a render's: a re-render keeps them. */
  foreignNodes: 'preserve',
} as const;

/** What `define` hands the setup: the element, with its declared attributes as props. */
interface InputHost extends HTMLElement {
  clearable: string | null;
  clearLabel: string | null;
  loading: string | null;
  reveal: string | null;
  revealLabel: string | null;
  capsLockHint: string | null;
  capsLockMessage: string | null;
}

/** The input the element serves: the user's own, else the default one it rendered. */
/**
 * **The input the element serves: the user's own, else the default one it rendered.** The first `<input>` in the host,
 * in tree order, that is not inside another custom element (an affix holding another component, a light-DOM select's
 * search box, is that component's); the user's is preferred over ours, so an input the user adds after connect (a
 * renderer that appends a parent before its children) takes over from the default one.
 */
const inputOf = (host: Element): HTMLInputElement | null => {
  let ours: HTMLInputElement | null = null;
  for (const input of host.querySelectorAll('input')) {
    let nested = false;
    for (let at = input.parentElement; at !== null && at !== host; at = at.parentElement)
      if (at.localName.includes('-')) {
        nested = true;
        break;
      }
    if (nested) continue;
    if (input.getAttribute('data-vera-part') !== 'input') return input;
    ours ??= input;
  }
  return ours;
};

/** Ours: the default input this element rendered (or a server rendered for it), never the user's. */
const isOurs = (input: Element | null): boolean => input !== null && input.getAttribute('data-vera-part') === 'input';

/** The clear decision's view of the input, read now. `:disabled` covers a disabled `<fieldset>` around it. */
const stateOf = (input: HTMLInputElement): ClearState => ({
  value: input.value,
  disabled: input.matches(':disabled'),
  readOnly: input.readOnly,
  expanded: input.getAttribute('aria-expanded'),
});

/**
 * **Clears through the platform's own editing**, so the input's undo history keeps the text: `select()` then
 * `execCommand('delete')` fires a trusted `input` (`deleteContentBackward`) that frameworks see as typing, and Ctrl/Cmd+Z
 * restores it (measured on Chromium 151, Firefox 153 and WebKit 26.5; the value setter dropped the undo stack on all
 * three). Only where `execCommand` refuses does the setter run, with an `input` and a `change` built from the input's
 * own window, so a framework's `instanceof` checks see their realm's classes.
 *
 * The two paths differ on `change`, on purpose: the platform's editing fires it at blur, as for typing, while the
 * setter fires it at once, since a value set by script leaves the input clean and no `change` would ever come.
 */
const clear = (input: HTMLInputElement): void => {
  input.focus();
  input.select();
  const doc = input.ownerDocument;
  /** jsdom and some embedded engines have no execCommand at all: a missing one is a refusal, never a throw. */
  if (typeof doc.execCommand === 'function' && doc.execCommand('delete')) return;
  const win = doc.defaultView;
  if (win === null) return;
  /** The prototype's setter, not the instance's: React 19 tracks a controlled value through an own-property setter. */
  Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')?.set?.call(input, '');
  input.dispatchEvent(new win.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  input.dispatchEvent(new win.Event('change', { bubbles: true }));
};

/** The clear button: a real button, named, out of the tab order (select-all then Delete, or Escape, is the keyboard's). */
const makeClear = (doc: Document): HTMLButtonElement => {
  const button = doc.createElement('button');
  button.type = 'button';
  button.tabIndex = -1;
  button.setAttribute('data-vera-part', 'clear');
  button.setAttribute('data-vera-input', '');
  return button;
};

/** The input has an accessible name of its own or from a label (a placeholder is not one). */
const named = (input: HTMLInputElement): boolean =>
  (input.labels !== null && input.labels.length > 0) ||
  input.hasAttribute('aria-label') ||
  input.hasAttribute('aria-labelledby') ||
  input.hasAttribute('title');

/**
 * Development: the warnings this host and its input call for, once per connect. Read a task after connect, so a
 * `<vera-field>` around it (whose wiring labels the input in its own effect) has run first.
 */
const warn = (host: InputHost, input: HTMLInputElement): void => {
  const subject = `<${host.localName}>`;
  for (const code of warnings({
    named: named(input),
    reveal: host.hasAttribute('reveal'),
    type: input.type,
    sizeOnHost: host.hasAttribute('size'),
  }))
    console.warn(diagnostic('input', subject, code, __DEV__ && PROSE[code](quoted(input.type))));
};

/**
 * **Clear, while `clearable`**: one `input` listener, one `keydown` (Escape, acted on only for a search input: the type
 * is read at the key, since a page may change it) and a `reset` listener on the input's form, which reset changes
 * without an `input` event; a `pageshow` restoring the page from bfcache is read the same way. Nothing at all without
 * the option. Returns the release.
 */
const clearing = (host: InputHost, input: HTMLInputElement): (() => void) => {
  const doc = input.ownerDocument;
  const win = doc.defaultView;
  const button = makeClear(doc);
  button.setAttribute('aria-label', host.clearLabel ?? 'Clear');
  const show = (): void => void (button.hidden = !clearShown(stateOf(input)));
  const onClick = (): void => {
    clear(input);
    show();
  };
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.isComposing || !escapeClears(input.type, stateOf(input))) return;
    event.preventDefault();
    clear(input);
    show();
  };
  /** A form's reset writes the values after its `reset` event, so the read waits a task. */
  const onReset = (): void => void win?.setTimeout(show, 0);
  const onPageshow = (event: PageTransitionEvent): void => {
    if (event.persisted) show();
  };
  const form = input.form;
  input.after(button);
  show();
  button.addEventListener('click', onClick);
  input.addEventListener('input', show);
  input.addEventListener('keydown', onKeydown);
  form?.addEventListener('reset', onReset);
  win?.addEventListener('pageshow', onPageshow);
  return () => {
    button.removeEventListener('click', onClick);
    input.removeEventListener('input', show);
    input.removeEventListener('keydown', onKeydown);
    form?.removeEventListener('reset', onReset);
    win?.removeEventListener('pageshow', onPageshow);
    button.remove();
  };
};

/**
 * **Loading**: `aria-busy="true"` on the input (never on the host: a busy ancestor of the focused field lets a reader
 * hold back the field's own content) and an `aria-hidden` mark after it. Nothing is announced: the busy state is the
 * signal, and a spinner the user puts inside speaks for itself. An `aria-busy` the user set is left as theirs.
 */
const busy = (input: HTMLInputElement): (() => void) => {
  const mark = input.ownerDocument.createElement('span');
  mark.setAttribute('data-vera-part', 'loading');
  mark.setAttribute('data-vera-input', '');
  mark.setAttribute('aria-hidden', 'true');
  const theirs = input.hasAttribute('aria-busy');
  if (!theirs) input.setAttribute('aria-busy', 'true');
  input.after(mark);
  return () => {
    mark.remove();
    if (!theirs) input.removeAttribute('aria-busy');
  };
};

/**
 * **The current input, kept true while connected.** While the user's input is served: an observer of each ancestor from
 * its parent up to the host, childList only, so typing and the element's own parts beside it never wake it. While no
 * input or only ours is served: the host's whole subtree, since the user's may still arrive anywhere inside (a
 * renderer appends an empty wrapper, then the input into it; the wrapper's arrival alone finds nothing). Writes the
 * input into `current` only when it changes. Returns the release.
 */
const tracking = (
  host: Element,
  current: { value: HTMLInputElement | null },
  own: { value: boolean },
): (() => void) | undefined => {
  const win = host.ownerDocument.defaultView;
  if (win === null) return undefined;
  const observer = new win.MutationObserver(() => track());
  const track = (): void => {
    const input = inputOf(host);
    /** Read untracked: the effect that runs this first call must not subscribe to its own write. */
    if (input !== untrack(() => current.value)) current.value = input;
    /** A user's input arrived after connect: the default input is dropped from the render, and theirs is served. */
    if (input !== null && !isOurs(input) && untrack(() => own.value)) own.value = false;
    observer.disconnect();
    if (input === null || isOurs(input)) {
      observer.observe(host, { childList: true, subtree: true });
      return;
    }
    /** The chain ends at the host: the input was found inside it. */
    for (let at = input.parentNode; at !== null; at = at.parentNode) {
      observer.observe(at, { childList: true });
      if (at === host) break;
    }
  };
  track();
  return () => observer.disconnect();
};

/**
 * The setup: with the user's own input, no render (their children are theirs); with none, one default input, rendered
 * from the host's listed attributes read once here. A server-rendered default input carries `data-vera-part="input"`,
 * so the client renders the same template over it and hydrates rather than reading it as the user's. A host that
 * connects before its children exist (a renderer appending top-down, the parser after an early definition) renders
 * the default input first; when the user's input then arrives, the render drops ours and every part moves to theirs.
 *
 * Each option is its own effect reading its own prop and the CURRENT input, so turning one on or off adds or removes
 * only its part, and an input the page swaps (a framework re-render, of the input or of a wrapper around it) moves every
 * part beside the new one: each effect's release takes its part and listeners off the old input first.
 */
export const setup = (host: InputHost) => {
  const supplied = inputOf(host);
  const own = signal(supplied === null || isOurs(supplied));
  /** Read once: a host given its own input at connect never renders, so its children are never a render's. */
  const renders = own.value;
  if (!isServer()) {
    /**
     * The look, adopted into the root the element renders in as a layout effect: a move into another document or a
     * shadow root re-runs it there before the parts paint (kbd's and spinner's rule).
     */
    effect(() => adoptOwnSheet(host, SHEET, LOOK), { timing: 'layout' });
    const current = signal<HTMLInputElement | null>(null);
    effect(() => tracking(host, current, own));
    effect(() => {
      const input = current.value;
      return input !== null && host.clearable !== null ? clearing(host, input) : undefined;
    });
    effect(() => {
      const input = current.value;
      return input !== null && host.loading !== null ? busy(input) : undefined;
    });
    /** Reveal only on a password input (read now: reveal itself switches the type); anywhere else development warns. */
    effect(() => {
      const input = current.value;
      return input !== null && host.reveal !== null && input.type === 'password'
        ? revealing(input, host.revealLabel ?? 'Show password')
        : undefined;
    });
    effect(() => {
      const input = current.value;
      return input !== null && host.capsLockHint !== null ? capsHint(input, host.capsLockMessage ?? 'Caps Lock is on') : undefined;
    });
    if (__DEV__)
      effect(() => {
        const input = current.value;
        const win = host.ownerDocument.defaultView;
        if (input === null || win === null) return undefined;
        const timer = win.setTimeout(() => warn(host, input), 0);
        /** The default input keeps what it was made with; a later change on the host is the two-sources bug. */
        const observer = own.value
          ? new win.MutationObserver((records) => {
              for (const record of records)
                console.warn(diagnostic('input', `<${host.localName}>`, 'input-host-changed', __DEV__ && PROSE['input-host-changed'](String(record.attributeName))));
            })
          : null;
        observer?.observe(host, { attributes: true, attributeFilter: [...COPIED] });
        return () => {
          win.clearTimeout(timer);
          observer?.disconnect();
        };
      });
  }
  if (!renders) return undefined;
  const copied = new Map(copiedFrom((name) => host.getAttribute(name)));
  return () =>
    !own.value
      ? null
      : html`<input data-vera-part="input" name=${copied.get('name') ?? null} type=${copied.get('type') ?? null} value=${copied.get('value') ?? null} placeholder=${copied.get('placeholder') ?? null} autocomplete=${copied.get('autocomplete') ?? null} />`;
};
