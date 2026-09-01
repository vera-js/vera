/**
 * Component classes that extend other component classes, in both DOM modes.
 *
 * No other SSR fixture uses inheritance — every one is `extends HTMLElement` — and the light-DOM half
 * of this is where Defect 58 lived: a hoist flag read off the constructor is inherited, so a subclass
 * was skipped entirely. On the server that is deterministic rather than order-dependent, because
 * definitions always run base-first.
 */
import { init, render, html } from '@verajs/core';

class LightBase extends HTMLElement {
  static styles = 'p { color: red }';
  connectedCallback() {
    init(this);
    render(() => html`<p>${this.getAttribute('label') ?? this.localName}</p>`);
  }
}
/** Overrides the styles, inherits the rest. */
class LightFancy extends LightBase {
  static styles = 'p { color: blue }';
}
/** Overrides nothing — it still needs its own scope, because its tag is different. */
class LightBare extends LightBase {}

class ShadowBase extends HTMLElement {
  static styles = 'p { color: green }';
  connectedCallback() {
    init(this, { mode: 'open' });
    render(() => html`<p>${this.getAttribute('label') ?? this.localName}</p>`);
  }
}
class ShadowFancy extends ShadowBase {
  static styles = 'p { color: teal }';
}

customElements.define('light-base', LightBase);
customElements.define('light-fancy', LightFancy);
customElements.define('light-bare', LightBare);
customElements.define('shadow-base', ShadowBase);
customElements.define('shadow-fancy', ShadowFancy);

export default class InheritHost extends HTMLElement {
  connectedCallback() {
    init(this);
    render(
      () => html`<light-base label="b"></light-base><light-fancy label="f"></light-fancy><light-bare label="r"></light-bare><shadow-base label="s"></shadow-base><shadow-fancy label="t"></shadow-fancy>`
    );
  }
}
customElements.define('inherit-host', InheritHost);
