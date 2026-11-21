/**
 * **<vera-spinner>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * The arc is decorative (`aria-hidden`); what a screen reader hears is `label`, said once through
 * `@vera-hooks/announce`'s `want()` when the wait outlasts its settle window (~150 ms), so a fast load says nothing,
 * twenty spinners starting together say it once, and a framework that replaces its spinner every frame still says it
 * once (the hook keys a load by its label). The host never takes `role="status"`: a live region inserted with its text
 * already inside is spoken inconsistently, and a second voice beside the hook's would double it. Inside an
 * `aria-busy="true"` owner nothing is said: the owner speaks.
 *
 * The arc's rule is adopted by the element itself (`adoptOwnSheet`), never through `@verajs/styles`: without it a
 * spinner shows nothing at all, so "busy" would be lost on a page that never wired styles.
 */
import { effect, html, isServer } from '@verajs/core';
import { underBusy, want } from '@vera-hooks/announce';
import { adoptOwnSheet, diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';
import { ARC, SHEET } from './spinner/sheet.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-spinner', attributes: ['label', 'done-label', 'show-label'] } as const;

/** What `define` hands the setup: the element, with its three declared attributes as props. */
interface SpinnerHost extends HTMLElement {
  label: string | null;
  doneLabel: string | null;
  showLabel: string | null;
}

/** How long development waits before calling a spinner silent: the hook's own settle window, so a late owner counts. */
const SILENT_MS = 150;

/** An attribute's text, trimmed; empty when absent. */
const text = (value: string | null): string => (value ?? '').trim();

/**
 * The setup: adopts the arc's rule into the element's root, and asks for its label while it is connected.
 *
 * - Both are effects, never setup statements: a spinner moved into another document keeps its setup and re-runs its
 *   effects (core's move rule), so the rule follows it into each root, and its wish moves to that document's region.
 * - The wish is released by the effect's cleanup (removal, or a label change), which is how the hook tells a finished
 *   load from a running one.
 */
export const setup = (host: SpinnerHost) => {
  effect(() => adoptOwnSheet(host, SHEET, ARC), { timing: 'layout' });
  effect(() => {
    if (isServer()) return;
    const label = text(host.label);
    if (label === '') {
      if (!__DEV__) return;
      const win = host.ownerDocument.defaultView;
      if (win === null) return;
      const timer = win.setTimeout(() => {
        if (host.isConnected && !underBusy(host))
          console.warn(diagnostic('spinner', '<vera-spinner>', 'spinner-silent', __DEV__ && PROSE['spinner-silent']()));
      }, SILENT_MS);
      return () => win.clearTimeout(timer);
    }
    const done = text(host.doneLabel);
    const wanted = want(host, label, done === '' ? {} : { done });
    return () => wanted.release();
  });
  return () => {
    const label = text(host.label);
    return html`<span data-vera-part="arc" aria-hidden="true"></span>${
      host.showLabel !== null && label !== '' ? html`<span data-vera-part="label">${label}</span>` : ''
    }`;
  };
};
