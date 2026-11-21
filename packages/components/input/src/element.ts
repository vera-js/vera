/**
 * **<vera-input>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 */
import { html } from '@verajs/core';

/** The tag and the element's declared options, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-input' } as const;

/**
 * The setup: runs once per element; returns its render. Components render in light DOM, where a `<slot>` does
 * nothing (package-structure refuses one): the render is the component's own parts, and children the user wrote are
 * the user's, read where they are and never moved.
 */
export const setup = () => () => html`<span data-vera-part="root"></span>`;
