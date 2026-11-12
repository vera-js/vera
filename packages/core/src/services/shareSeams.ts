/**
 * **What core hands to the modules wired to it, set once at load.** Every member is `$`-named so it survives mangling
 * (the readers are other bundles), and `types.ts`'s `CoreSeams` documents each one: what sets it, what reads it. This
 * module is imported by `index.ts` alone, for effect, so it is the one place core's machinery reaches the registry;
 * every other module only reads the view (`seams.ts`).
 */
import { MINE } from '../store/store.js';
import { initWith, rehomeElement, retireElement } from '../modules/init.js';
import { untracked, untrack } from '../modules/untrack.js';
import { walkItems, rawItems } from './lists.js';
import { createStore } from '../modules/createStore.js';
import { createHook, register, retire, RENDER_PRIORITY, MODE_QUEUED, bare, retireHook, ownerOf, own, settle, serverTurn } from '../modules/createHook.js';
import { seams } from './seams.js';

/**
 * Core's tracking control, handed OFF the insert chains: not an extension point — it is core's own tracking cell, and
 * nothing wired later may replace it.
 */
seams.$t = untracked;
/**
 * A keyed list's per-row QUEUED hook (an explicit owner, chained to the running host by `register`), and its retirement.
 * The record itself, not a `callable` wrapper: one closure fewer per list row (the keyed module calls its `$n`).
 */
seams.$q = (owner, callback) => register(owner, callback, RENDER_PRIORITY, MODE_QUEUED);
seams.$z = retire;
/** A keyed row's BARE hook (no owner hook list, retired directly) and the hook → owner read a shared row callback needs. */
seams.$qb = bare;
seams.$zh = retireHook;
seams.$ow = ownerOf;
/** A module claims something for the current run of a hook; the run's end disposes what it did not claim. */
seams.$own = own;
/** A module whose own hooks own things settles them where their runs end (`$so(hook)`), or disposes all (`$so(hook, true)`). */
seams.$so = settle;
/** A server render's turn: `$ss(1)` opens it, `$ss(-1)` closes it and unlinks what it created. */
seams.$ss = serverTurn;
/**
 * For `@verajs/renderer/native-elements` (a module never imports core at runtime): core's own setup (`$in`) and its
 * removal's whole teardown (`$td`), so a built-in host gets the lifecycle a custom element's callbacks give it; and a
 * built-in host moved into another document re-homes as a component does (`$rh`, called by native-elements' sentinel).
 */
seams.$in = initWith;
seams.$td = retireElement;
seams.$rh = rehomeElement;
/**
 * This copy's component mark (`MINE`, a Symbol private to each copy of core), so a release walking a dead window
 * retires only THIS core's components: two copies on a page never retire each other's.
 */
seams.$m = MINE;
/**
 * A store array's raw walk under ONE subscription (`walkItems`), so a keyed list walks a 1000-row store list without
 * 2000 trapped, tracked reads (measured 2026-10-18: a store walk 280 µs vs a plain one 2; a keyed swap 232 → 55 µs and a
 * remove 287 → 58 in Chrome once it walks raw); and its raw read without a subscription (`rawItems`), so a keyed list
 * compares the slots it already met and walks only the rest.
 */
seams.$w = walkItems;
seams.$wr = rawItems;
/**
 * Core's store machinery, for a module that keeps stores of its own (`@verajs/directives`): a production directives
 * bundle inlines its own copy of core, and without this its stores and the page's hooks would live in two registries
 * (a directive write never woke a component). Position 0 is its PROTOCOL, as every cross-bundle seam carries one: a
 * module from another release declines it and keeps its own copy, rather than calling these with signatures it does
 * not know. Bump it whenever a signature here changes.
 */
seams.$s = [1, createStore, createHook, untrack];
