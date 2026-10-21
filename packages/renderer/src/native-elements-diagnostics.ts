/** **`@verajs/renderer/native-elements`' diagnostics — DEVELOPMENT ONLY.** Its bundle's own table, merged into the renderer's json. */
import type { Prose } from '@verajs/shared-utils';

export const PROSE: Record<string, Prose> = {
  'native-host-unsupported': (tag) => [
    `<${tag}> cannot carry the lifecycle native-elements gives a built-in host: it is an element core did not define (a custom element defined before core loaded, or a built-in tag that cannot hold a shadow root — ul, li, table, button…), or one that already has a shadow root — including one core attached from a shadow option or the app's renderer({ shadow }) default. It still renders; it is never released when removed.`,
    'Give init() a div, section, article, aside, header, footer, main, nav, p, span, blockquote or h1–h6 — or a custom element, which calls init(this) in its connectedCallback.',
  ],
  'native-host-shadow': () => [
    'this element carries native-elements’ own closed shadow root (how its lifecycle is heard), so it cannot be given another.',
    'Use a custom element for a host that needs its own shadow root — init(this, …) with { shadow } — or attach the shadow root to an element inside this one.',
  ],
};
