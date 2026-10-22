import { define, html } from '@verajs/core';

/**
 * A `define` component whose ATTRIBUTES drive its render, for the hydration handoff — the server delivers observed
 * attributes before connect (its shim upgrades as the parser does), so the markup carries the attribute values, and the
 * client, upgrading the same markup, must converge on it with ONE render (nothing to correct).
 */
(globalThis.__defineAttrsRenders ??= { n: 0 });
export default customElements.get('attrs-card') ??
  define({ tag: 'attrs-card', shadow: 'open', props: { tone: 'plain' }, attributes: ['label', 'data-count', 'tone'] }, (host) => () => {
    globalThis.__defineAttrsRenders.n++;
    return html`<p>${host.label} · ${host.dataCount} · ${host.tone}</p>`;
  });
