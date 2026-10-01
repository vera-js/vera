/**
 * `@verajs/ssr` from TypeScript, through its PUBLISHED declarations (`exports` → `types`, exactly as npm resolves them).
 *
 * The package is TypeScript compiled by `tsc`, and its declarations are the compiler's own. What this pins is the seam a
 * TypeScript user crosses: `SsrTemplate` is defined locally in `@verajs/ssr` (its declarations import no package), so
 * nothing but this file proves that a template from core's `html`, `svg` and `mathml`, or from the tag entry's `html`, is
 * assignable to it — and a structural mismatch there (the `_$litType$` key, readonly arrays, the strings type) would break
 * `serializeTemplate(html`…`)` for every TypeScript user with no runtime signal at all.
 */
import { renderToString, renderToStringAsync, serializeTemplate, registry } from '@verajs/ssr';
import type { SsrRenderOptions, SsrRenderResult } from '@verajs/ssr';
import { html, svg, mathml } from '@verajs/core';
import { html as tagHtml, tag } from '@verajs/renderer/tag';

const out: Promise<{ html: string; styles: string; title: string }> = renderToString(new URL('file:///x.js'), {});
void out;
const options: SsrRenderOptions = { tag: 'x-page', static: true };
const result: Promise<SsrRenderResult> = renderToStringAsync('./page.js', options);
void result;
/** The result is the caller's to post-process in place: its fields are not readonly. */
void result.then((r) => {
  r.html = r.html.toUpperCase();
});

/** Every template producer a user hands the serializer, and its answer is a string. */
const fromHtml: string = serializeTemplate(html`<p>${1}</p>`);
const fromSvg: string = serializeTemplate(svg`<circle r="1"></circle>`);
const fromMathml: string = serializeTemplate(mathml`<mi>x</mi>`);
const fromTag: string = serializeTemplate(tagHtml`<${tag`h1`}>x</${tag`h1`}>`);
void [fromHtml, fromSvg, fromMathml, fromTag];

const definition: CustomElementConstructor | undefined = registry.get('x-page');
void definition;
