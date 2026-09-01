/**
 * `@verajs/ssr` from TypeScript.
 *
 * The package publishes its source rather than a build — the one exemption from the TypeScript rule
 * in `CLAUDE.md` — and shipped **no declarations at all**, so a strict consumer got `TS7016` and was
 * told to write their own `declare module '@verajs/ssr'`. Both npm+TypeScript and SSR are
 * first-class consumption modes; their intersection did not work.
 *
 * The declarations are generated from the JSDoc the package is already type-checked against, so they
 * cannot drift from it. Nothing about what is published changes: `src` is still `src`, and there is
 * still no transpile step.
 */
import { renderToString, serializeTemplate } from '@verajs/ssr';
const out: Promise<{ html: string; styles: string; title: string }> = renderToString(new URL('file:///x.js'), {});
void out;
void serializeTemplate({ _$litType$: 1, strings: [] as unknown as TemplateStringsArray, values: [] });
