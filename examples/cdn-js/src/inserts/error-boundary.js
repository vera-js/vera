/**
 * An error boundary as an `'error'` insert — the chain core hands every hook error to instead of
 * letting one failing effect take out its siblings. With nothing registered, core falls back to
 * `console.error`; registering here is what turns isolation into an actual boundary.
 *
 *   import { errorBoundary } from './inserts/error-boundary.js';
 *   insert('error', errorBoundary, 50);
 *
 * This example renders a fallback into the failing component (its shadow root when it has one)
 * and keeps the error visible in the console. A real app might report to a tracker instead —
 * the insert receives `(error, element)` and can do anything.
 */
export const errorBoundary = (error, element) => {
  console.error('[vera boundary]', error, element);
  const root = element?.shadowRoot ?? element;
  if (!root) return;
  const fallback = document.createElement('p');
  fallback.setAttribute('role', 'alert');
  fallback.textContent = 'Something went wrong in this component.';
  root.replaceChildren(fallback);
};
