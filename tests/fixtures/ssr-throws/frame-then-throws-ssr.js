/**
 * A component that requests a frame and then throws from `connectedCallback`, before the drain that runs after the
 * callback returns. The frame writes the title from this render's location, or throws when `frameThenThrowsBoom` is set.
 */
export const RAN = [];
export default class FrameThenThrowsSsr extends HTMLElement {
  connectedCallback() {
    const path = location.pathname;
    requestAnimationFrame(() => {
      RAN.push(path);
      if (globalThis.frameThenThrowsBoom) throw new Error('boom-leftover-frame');
      document.title = `left over from ${path}`;
    });
    throw new Error('boom-frame-then-throws');
  }
}
customElements.define('frame-then-throws-ssr', FrameThenThrowsSsr);
