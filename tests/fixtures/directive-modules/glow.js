/** A lazily-loaded directive module: it REGISTERS ITSELF, exactly as an autoloaded component
 *  calls customElements.define — module caching makes this the page's own registry. */
import { wireDirectives } from '@verajs/directives';

wireDirectives({
  name: 'glow',
  value: 'literal',
  docs: { summary: 'test fixture', example: 'data-vd-glow="gold"' },
  setup(el) {
    el.setAttribute('data-glowing', el.getAttribute('data-vd-glow') || 'on');
    return () => el.removeAttribute('data-glowing');
  },
});
