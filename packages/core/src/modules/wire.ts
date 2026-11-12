import { wire as register, inserts } from '@verajs/inserts';
import { diagnostic, SHARED } from '@verajs/shared-utils';
import { redecideStores } from '../services/door.js';
import { seams } from '../services/seams.js';

/**
 * **Every copy of core sharing this registry re-decides its stores on a store wire** (D16). In development
 * `@verajs/inserts` stays external, so two copies on a page (a bundle that inlines core beside the page's own) share one
 * registry: a store module wired through either is in both chains, and each copy's decisions are its own. So each copy
 * pushes its re-decision onto the registry once, at load (`$rs`, sigiled: the copies are other bundles), and `wire`
 * calls every one. Development only: in production each bundle inlines its own registry, so a copy only ever re-decides
 * itself, and the production bundle keeps its single call.
 */
const redecideAll: (() => void)[] = __DEV__ ? (seams.$rs ??= []) : [];
if (__DEV__) redecideAll.push(redecideStores);

/**
 * Installs modules — `wire([renderer, styles])`. When that changed the `'store'` chain, every store type
 * is decided again, so a store module wired after stores exist reaches them all; wiring anything else
 * runs no store module at all.
 */
export const wire: typeof register = (item) => {
  const before = inserts.get('store')?.slice() ?? [];
  const decided = __DEV__ ? (inserts.get('template')?.length ?? 0) + (inserts.get('element')?.length ?? 0) : 0;
  register(item);
  const after = inserts.get('store') ?? [];
  if (after.length !== before.length || after.some((insert, i) => insert !== before[i]))
    if (__DEV__) for (let i = 0; i < redecideAll.length; i++) redecideAll[i]!();
    else redecideStores();
  /**
   * **A template decision is made once, as the template is built** — so a `'template'` or `'element'` module wired
   * after the renderer built templates never reaches those (they are cached for the life of the page), silently.
   * Stores are re-decided in place above; templates cannot be (the cache is a WeakMap, not a list), so development
   * says so. The renderer marks the registry once it has built a template.
   */
  if (
    __DEV__ &&
    seams.$b === true &&
    (inserts.get('template')?.length ?? 0) + (inserts.get('element')?.length ?? 0) > decided
  )
    console.warn(diagnostic('core', 'wire', 'late-template-module', __DEV__ && SHARED.lateTemplateModule()));
};
