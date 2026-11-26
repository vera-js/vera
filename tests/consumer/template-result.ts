/**
 * **The template result is declared three times, on purpose, and these pins keep the three in step** (2026-11-26),
 * through the PUBLISHED declarations. Core's tags (`html`, `svg`, `mathml`) PRODUCE `{ _$litType$, strings, values }`;
 * the renderer ACCEPTS a wider shape (`_$litType$` optional, and `keyed()`'s `key`); the server's serializer accepts the
 * widest (read-only, `strings: unknown`, since it checks for a literal's strings at run time). They cannot share one
 * declaration without a new dependency: the renderer's published `.d.ts` would then name core's private shared types.
 * So the contract is pinned by direction: what core produces, the renderer and the server take; what the renderer
 * takes, the server takes (`ssrcheck.ts` pins the tags into `serializeTemplate` by value). Type-level only: `tsc` fails
 * here when one drifts, a field renamed or retyped on any side.
 */
import { html, mathml, svg } from '@verajs/core';
import type { ResultType, TemplateResult as Produced } from '@verajs/core';
import type { TemplateResult as Rendered } from '@verajs/renderer';
import type { serializeTemplate } from '@verajs/ssr';

type Served = Parameters<typeof serializeTemplate>[0];
type Assignable<A, B> = [A] extends [B] ? true : false;
type Expect<T extends true> = T;

const tagged = [html`<b></b>`, svg`<g></g>`, mathml`<mi></mi>`];

export type TemplateResultPins = [
  Expect<Assignable<Produced<ResultType>, Rendered>>,
  Expect<Assignable<Produced<ResultType>, Served>>,
  Expect<Assignable<Rendered, Served>>,
  /** The tags' own return types too, not only the declared name. */
  Expect<Assignable<(typeof tagged)[number], Rendered>>,
  /** CONTROL: the helper can answer false. The renderer's shape is wider than core's, so it is not assignable back. */
  Expect<Assignable<Assignable<Rendered, Produced<ResultType>>, false>>,
];
