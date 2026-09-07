/**
 * A LAZILY-LOADED directive: this file was not on the page until an element carrying
 * `data-vd-sparkle` activated — the engine asked the 'loader' chain, the autoloader's
 * `directiveLoader` resolved it by convention ({base}/directives/sparkle.js), and this module
 * registered itself. Module caching makes the bare import below the PAGE's own registry —
 * the exact symmetry of an autoloaded component calling customElements.define.
 */
import { wireDirectives } from '@verajs/directives';

wireDirectives({
  name: 'sparkle',
  value: 'none',
  docs: { summary: 'Emits a ✨ from wherever you click the element. Loaded on demand.', example: 'data-vd-sparkle' },
  setup(el) {
    el.setAttribute('data-sparkle-ready', '');
    const burst = (event) => {
      const star = document.createElement('span');
      star.textContent = '✨';
      star.style.cssText =
        `position:fixed; left:${event.clientX}px; top:${event.clientY}px; pointer-events:none; ` +
        'font-size:1.4rem; transition:transform 0.9s ease-out, opacity 0.9s; z-index:99;';
      document.body.append(star);
      requestAnimationFrame(() => {
        star.style.transform = `translate(${(Math.random() - 0.5) * 120}px, -90px) rotate(${(Math.random() - 0.5) * 180}deg)`;
        star.style.opacity = '0';
      });
      setTimeout(() => star.remove(), 950);
    };
    el.addEventListener('click', burst);
    return () => el.removeEventListener('click', burst);
  },
});
