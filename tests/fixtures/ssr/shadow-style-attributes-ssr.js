/** Appends `<style>`s straight to its own shadow root, with and without attributes — see `tests/ssr-shadow-style-attributes.test.mjs`. */
class ShadowStyleAttributes extends HTMLElement {
  connectedCallback() {
    const root = this.attachShadow({ mode: 'open' });
    const style = (css, attributes) => {
      const element = document.createElement('style');
      for (const [name, value] of attributes) element.setAttribute(name, value);
      element.textContent = css;
      return element;
    };
    root.appendChild(style('.plain{color:green}', []));
    root.appendChild(style('p{color:red}', [['media', 'print'], ['nonce', 'abc123']]));
    root.appendChild(style('.after{color:gray}', []));
    root.appendChild(style('.quoted{color:navy}', [['title', 'a "b" & c']]));
    /** Marked as `@verajs/styles` marks its own: served with ONE marker, and the other attribute kept. */
    root.appendChild(style('.marked{color:teal}', [['data-vm-sheet', 'styles'], ['media', 'screen']]));
    /** An event-handler attribute: served at this door exactly as the div-held one below serves it (one rule, two doors). */
    root.appendChild(style('.handler{color:olive}', [['onload', 'go("x")']]));
    /** The control: the same attributed style one level down is content, and has always kept them. */
    const holder = document.createElement('div');
    holder.appendChild(style('p{color:blue}', [['media', 'print'], ['nonce', 'abc123']]));
    holder.appendChild(style('.handler{color:olive}', [['onload', 'go("x")']]));
    root.appendChild(holder);
    const p = document.createElement('p');
    p.textContent = 'x';
    root.appendChild(p);
  }
}
customElements.define('shadow-style-attributes-ssr', ShadowStyleAttributes);

/**
 * One root with appended sheets AND an adopted one, twice: `attributed` gives its middle sheet `media="print"`, `bare`
 * gives it none. A root with an attributed sheet serves its sheets on a path of its own, and the adopted sheet through
 * the shared one; the two roots must serve the same tags in the same order but for that one attribute.
 */
const both = (attributes) =>
  class extends HTMLElement {
    connectedCallback() {
      const root = this.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync('.adopted{color:purple}');
      root.adoptedStyleSheets = [sheet];
      for (const [css, own] of [['.first{color:green}', []], ['.middle{color:red}', attributes], ['.last{color:gray}', []]]) {
        const element = document.createElement('style');
        for (const [name, value] of own) element.setAttribute(name, value);
        element.textContent = css;
        root.appendChild(element);
      }
      root.appendChild(document.createElement('p'));
    }
  };
customElements.define('shadow-style-attributed-adopted-ssr', both([['media', 'print']]));
customElements.define('shadow-style-bare-adopted-ssr', both([]));
