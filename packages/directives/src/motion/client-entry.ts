/**
 * `@verajs/directives/motion-client` — the READER's entry: delivery and the number's writer,
 * with NO compiler at all. For embedders whose server generates every rule (omni's PHP front
 * end is the shape): the client acquires pre-generated CSS, drives the variables, feeds ticks —
 * and never parses or generates anything. The `/motion-ssr` split's logic pointed the other
 * direction, and the smallest true adoption cost for a compile-less front end.
 *
 * MODE DISPATCH FROM MARKUP is a structural contract with TWO clauses, and both are the
 * contract (the one-clause version had a hole the entry-flash fix itself created):
 *
 * 1. **Server-emitted markup**: the ARMED marker (`data-vm-armed`, or the embedder's rename)
 *    exists ONLY in transition-mode emission and every SSR writer PRE-ARMS — a writer
 *    obligation, stated here — so `hasAttribute(armed)` IS the transition-mode bit for any
 *    element that arrived in markup.
 * 2. **Programmatic registration**: a late-inserted transition element is deliberately UNARMED
 *    until its base state commits (arming at write time is the animate-into-base bug), so a
 *    reader must NEVER markup-infer mode for elements it was handed at runtime — the
 *    registration carries `Generated.mode` explicitly, and that field is the bit.
 */
export {
  acquire, release, contentHash, ensureProperty, setTails,
  PROGRESS_PROPERTY, STAGGER_PROPERTY, SCROLL_PROPERTY,
  RANGE_START_PROPERTY, RANGE_SIZE_PROPERTY,
} from './registry.js';
export { syncTo, rampTo, dispose } from './drive.js';

export { wireTicks, tickFor } from './ticks.js';

export type { Driven, SheetRoot, TickFunction, TickModule } from './types.js';
