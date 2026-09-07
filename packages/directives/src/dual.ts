/**
 * `dual` — the one spelling of "usable bare OR configured", for pack authors.
 *
 * `wireDirectives([motion])` takes the defaults; `wireDirectives([motion({ inertia: 0.2 })])`
 * configures. Both must work, because a pack with entirely optional options should not force a
 * call — the same allowance core's own modules make (CLAUDE.md's wireable-shapes rule: no options
 * → a bare descriptor, required options → a factory, OPTIONAL options → this).
 *
 * It dispatches on the sigiled `_$seams$` mark: called by the ENGINE it receives the seams object
 * and connects with defaults; called by the AUTHOR it receives options (or nothing) and returns
 * the connector. Sigiled because that mark crosses a bundle boundary and property mangling must
 * not touch it.
 *
 * **A pure function in its own module, on purpose.** Each pack bundle inlines its own copy, which
 * is exactly right: the additive rule forbids shared mutable STATE across bundles — two registries
 * where there should be one — and says nothing about pure code, which has no identity to disagree
 * about. This lived in `engine.ts` as `pack()` until 2026-09-07, where it was unreachable by the
 * only callers it could ever have (a pack cannot import the engine at runtime) and therefore dead
 * bytes in every engine build, while three packs each hand-rolled the same four lines of cast soup.
 */
import type { EngineConnector, EngineSeams } from './types.js';

export const dual = <O>(
  build: (options?: O) => EngineConnector
): ((options?: O) => EngineConnector) & EngineConnector =>
  ((arg?: unknown) =>
    arg && (arg as { _$seams$?: true })._$seams$ === true
      ? build()(arg as EngineSeams)
      : build(arg as O | undefined)) as ((options?: O) => EngineConnector) & EngineConnector;
