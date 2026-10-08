/**
 * **One renderer, hydration wired** — what an app writes: `wire([renderer, hydration])`. Returns the renderer's
 * `renderInto`, which now adopts a container's server output on its first render. Both are wired as MODULES: the
 * renderer's `connect` sets the hand-off hydration reads, so wiring the bare function would hydrate nothing.
 */
import { load } from './dist.mjs';

let wired;
export const hydrating = () =>
  (wired ??= (async () => {
    const { wire } = await load('core');
    const { renderInto, renderer } = await load('renderer');
    const { hydration } = await load('renderer/hydration');
    wire([renderer, hydration]);
    return renderInto;
  })());
