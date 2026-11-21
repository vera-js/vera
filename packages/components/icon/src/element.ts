/**
 * **<vera-icon>: its options and its setup.** Never calls `define`: `register.ts` does, so importing the `./element`
 * entry registers nothing.
 *
 * The icon is either the user's own `<svg>` child, kept byte-identical, or a `src` rendered as `<svg><use href>` (no
 * markup is ever fetched or parsed: string → DOM is refused by construction). Its accessible role lives on the HOST, so
 * the user's markup is never written to: decorative by default (`aria-hidden`), or `role="img"` with `aria-label` when
 * `label` is set. Size, color and the RTL flip are the styles layer's (`scale`, `flip`), read by CSS alone.
 */
import { effect, html } from '@verajs/core';
import { diagnostic } from '@verajs/shared-utils';
import { PROSE } from './diagnostics.js';

/** The tag and the element's declared attributes, handed to core's `define` by `register.ts`. */
export const options = { tag: 'vera-icon', attributes: ['label', 'src'] } as const;

/** What `define` hands the setup: the element, with its two declared attributes as props. */
interface IconHost extends HTMLElement {
  label: string | null;
  src: string | null;
}

/**
 * Whether `src` may be rendered: relative, or `http(s):` on the document's own origin. An ALLOW-list, so every other
 * scheme (`javascript:`, `data:`, `blob:`, and any to come) is refused (probe 2026-11-21: the platform already blocks
 * `data:` and cross-origin in `<use>`, and allows `blob:`; refusing it here is our rule, stricter and safe).
 *
 * @param src The attribute's value
 * @param base The document the icon is in, for its base URL and origin
 * @returns `'ok'`, `'cross-origin'` or `'scheme'`
 */
export const vet = (src: string, base: Document): 'ok' | 'cross-origin' | 'scheme' => {
  let url: URL;
  try {
    url = new URL(src, base.baseURI);
  } catch {
    return 'scheme';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'scheme';
  return url.origin === new URL(base.baseURI).origin ? 'ok' : 'cross-origin';
};

/** The user's own `<svg>` child, if they wrote one (a direct child: a nested one belongs to whatever holds it). */
const ownSvg = (host: Element) => {
  for (const child of host.children) if (child.localName === 'svg') return child;
  return null;
};

/** The setup: keeps the host's role in step with `label`, and renders `src` when there is no child `<svg>`. */
export const setup = (host: IconHost) => {
  effect(() => {
    const label = host.label;
    if (label) {
      host.removeAttribute('aria-hidden');
      host.setAttribute('role', 'img');
      host.setAttribute('aria-label', label);
    } else {
      host.removeAttribute('role');
      host.removeAttribute('aria-label');
      host.setAttribute('aria-hidden', 'true');
    }
  });
  return () => {
    const src = host.src;
    if (!src) return null;
    if (ownSvg(host)) {
      if (__DEV__) console.warn(diagnostic('icon', '<vera-icon>', 'icon-two-sources', __DEV__ && PROSE['icon-two-sources']()));
      return null;
    }
    const verdict = vet(src, host.ownerDocument);
    if (verdict !== 'ok') {
      // One call per code, each named literally, so the diagnostics table test can pair every raised code with its entry.
      if (__DEV__) {
        const subject = `<vera-icon src="${src}">`;
        console.warn(verdict === 'scheme'
          ? diagnostic('icon', subject, 'icon-scheme', __DEV__ && PROSE['icon-scheme']())
          : diagnostic('icon', subject, 'icon-cross-origin', __DEV__ && PROSE['icon-cross-origin']()));
      }
      return null;
    }
    return html`<svg data-vera-part="svg" aria-hidden="true" focusable="false"><use href=${src}></use></svg>`;
  };
};
