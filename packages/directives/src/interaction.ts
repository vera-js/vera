/**
 * The phase-1 interaction pack: `state`, `show`, `class`, and the `on-*` event family. Each row
 * of the catalog gets its full §12 design pass as it lands; these four are the vertical slice.
 */
import { stateDirective, onFamily } from './engine.js';
import { isObject } from './parse.js';
import type { Directive } from './types.js';

/** `show` reflects to `hidden`; the engine's adopted base rule makes `hidden` unbeatable (§20.2). */
const show: Directive = {
  name: 'show',
  value: 'expression',
  docs: { summary: 'Shows the element while the expression is truthy.', example: 'data-vd-show="open"' },
  apply(el, value) {
    (el as HTMLElement).hidden = !value;
  },
};

/** `class` toggles one class per key — an object of `name: expression` (design §10). */
const classDirective: Directive = {
  name: 'class',
  value: 'object',
  docs: { summary: 'Toggles classes from an object of name: expression.', example: 'data-vd-class="{ is-open: open }"' },
  apply(el, value, ctx) {
    if (!isObject(value as never)) {
      ctx.reject('class-not-object', 'data-vd-class takes a braced object of name: expression.');
      return;
    }
    const entries = value as Record<string, unknown>;
    /** classList, never className — SVG's className is an SVGAnimatedString (design §16). Every
     *  entry evaluates inside this one engine-owned hook, so one state change re-toggles the lot. */
    for (const name of Object.keys(entries)) el.classList.toggle(name, !!ctx.eval(entries[name]));
  },
};

/** The event family — registry-declarative; the engine's delegation does all the work (§3E). */
const on: Directive = {
  name: onFamily,
  value: 'object',
  priority: 70,
  docs: { summary: 'Runs an assignments object when the event fires.', example: 'data-vd-on-click="{ open: !open }"' },
};

export const interaction: Directive[] = [stateDirective, show, classDirective, on];
