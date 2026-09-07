/**
 * The directives showcase: every shipped surface, live, each demo displaying the exact markup
 * that produced it — `<demo-block>` renders its children AND prints them, so the code beside a
 * demo structurally cannot drift from the demo.
 *
 * The page is buildless on the PRODUCTION bundles, which makes it a live proof of substrate
 * adoption: `@verajs/directives` bakes its own copy of core's store machinery, `wire()` stamps
 * the page's real core, and the `<mirror-count>` component on the State page subscribes to a
 * DIRECTIVE's store through ordinary component hooks — one registry, two paradigms.
 */
import { wire, html, init, useEffect } from '@verajs/core';
import { renderInto, renderer } from '@verajs/renderer';
import { initRouter, setRouterRenderer, setBasePath, router } from '@verajs/router';
import {
  wireDirectives, directives, interaction, expressions,
  motion, easings, paint, path, split, sequence,
  rejections, describeDirectives, settled, stateOf,
  enableMotion, disableMotion,
} from '@verajs/directives';

setBasePath('/examples/directives');
setRouterRenderer(renderInto);
wire([renderer, router, directives]);
wireDirectives([
  expressions,
  ...interaction,
  motion({ inertia: 0.12, breakpoints: { phone: [0, 560], wide: [1100, null] } }),
  easings, paint, path, split, sequence,
]);

/* ────────────────────────────────────────────────────────────────────────────
 * <demo-block caption="…">: the honesty device. Children are the demo; their
 * serialized form is the displayed source. One origin, two renderings.
 * ──────────────────────────────────────────────────────────────────────────── */
const dedent = (text) => {
  const lines = text.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)[0].length);
  const cut = Math.min(...indents, 99);
  return lines.map((l) => l.slice(cut)).join('\n');
};

customElements.define('demo-block', class extends HTMLElement {
  connectedCallback() {
    if (this.dataset.built) return;
    this.dataset.built = '1';
    const source = dedent(this.innerHTML);
    const live = document.createElement('div');
    live.className = 'demo-live';
    while (this.firstChild) live.append(this.firstChild);
    const caption = document.createElement('div');
    caption.className = 'demo-caption';
    caption.textContent = this.getAttribute('caption') ?? '';
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'the markup that built this';
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = source;
    pre.append(code);
    details.append(summary, pre);
    this.append(caption, live, details);
  }
});

/* A vera component subscribing to a DIRECTIVE's store — the adoption interop, live. */
customElements.define('mirror-count', class extends HTMLElement {
  connectedCallback() {
    init(this);
    const carrier = this.closest('[data-vd-state]');
    useEffect(() => {
      const store = carrier && stateOf(carrier);
      this.textContent = store ? `the component reads ${store.n} through core's hooks` : '…';
    });
  }
});

/* The live vocabulary, straight from describeDirectives() — the GUI story. */
customElements.define('vocab-table', class extends HTMLElement {
  connectedCallback() {
    const rows = describeDirectives()
      .filter((d) => d.summary)
      .map((d) => `<tr><td><code>data-vd-${d.name}</code></td><td>${d.value}</td><td>${d.summary}</td></tr>`)
      .join('');
    this.innerHTML = `<table class="vocab"><thead><tr><th>directive</th><th>value</th><th>does</th></tr></thead><tbody>${rows}</tbody></table>`;
  }
});

/* Every refusal on the page, polled — what a GUI renders instead of a console. */
customElements.define('rejections-panel', class extends HTMLElement {
  connectedCallback() {
    const render = () => {
      const all = rejections();
      const rows = all.slice(-14).map((r) =>
        `<li><code>${r.code}</code> ${r.message ? `— ${r.message}` : ''}</li>`).join('');
      this.innerHTML = `<p>${all.length} refusal(s) recorded on this page so far. The engine never throws at markup — it explains:</p><ul class="rejections">${rows}</ul>`;
    };
    render();
    this._timer = setInterval(render, 800);
  }
  disconnectedCallback() { clearInterval(this._timer); }
});

/* Insert/remove churn: the engine activates and tears down whatever appears. */
customElements.define('churn-lab', class extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `<button>insert a fully-armed row</button> <button disabled>remove last</button><div></div>`;
    const [addButton, removeButton] = this.querySelectorAll('button');
    const zone = this.querySelector('div');
    addButton.onclick = () => {
      const row = document.createElement('div');
      row.className = 'card';
      row.innerHTML = `<span data-vd-state="{ n: 0 }">
        <button data-vd-on-click="{ n: n + 1 }">+1</button>
        <b data-vd-text="n"></b> <i data-vd-show="n > 4">— that's plenty</i></span>`;
      zone.append(row);
      removeButton.disabled = false;
    };
    removeButton.onclick = () => {
      zone.lastElementChild?.remove();
      removeButton.disabled = !zone.children.length;
    };
  }
});

/* ──────────────────────────────────────────────────────────────────────────── */

/**
 * Static section text as a real template: the strings array is built once per
 * section and cached, because TEMPLATE IDENTITY IS THE STRINGS ARRAY — a fresh
 * array per render would rebuild the section's DOM on every navigation.
 */
const SECTION_TEMPLATES = new Map();
const section = (text) => {
  let template = SECTION_TEMPLATES.get(text);
  if (!template) {
    template = Object.assign([text], { raw: [text] });
    SECTION_TEMPLATES.set(text, template);
  }
  return html(template);
};

const page = (title, lede, body) => html`
  <h1>${title}</h1>
  <p class="lede">${lede}</p>
  ${section(body)}
`;

const HOME = `
  <h2>What this page is</h2>
  <p>Every directive this system ships, live, organised by purpose — and every demo carries
  <em>the markup that built it</em>, rendered from the same nodes so it cannot lie. No build step:
  the import map points at the production bundles, exactly as a CDN page would.</p>
  <demo-block caption="The entire wiring of this page — nothing else is set up anywhere.">
    <pre><code>import { wire } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { router } from '@verajs/router';
import {
  wireDirectives, directives, interaction, expressions,
  motion, easings, paint, path, split, sequence,
} from '@verajs/directives';

wire([renderer, router, directives]);
wireDirectives([
  expressions,
  ...interaction,
  motion({ inertia: 0.12, breakpoints: { phone: [0, 560], wide: [1100, null] } }),
  easings, paint, path, split, sequence,
]);</code></pre>
  </demo-block>
  <demo-block caption="Proof of life: state, an expression, a click — the page's hello world.">
    <div data-vd-state="{ taps: 0 }">
      <button data-vd-on-click="{ taps: taps + 1 }">tap</button>
      <span class="pill" data-vd-text="taps"></span>
      <span data-vd-show="taps >= 5">— you may stop now</span>
    </div>
  </demo-block>
  <h2>The live vocabulary</h2>
  <p>Read from <code>describeDirectives()</code> at load — the same introspection a GUI builds
  its panels from. Wire another pack and this table grows by itself.</p>
  <vocab-table></vocab-table>
`;

const STATE = `
  <h2>data-vd-state — the nouns</h2>
  <demo-block caption="A carrier owns keys; descendants read the NEAREST owner. Initials are expressions evaluated in declaration order.">
    <div data-vd-state="{ base: 4, double: base * 2 }">
      <p>base <b data-vd-text="base"></b>, and double was seeded from it:
      <b data-vd-text="double"></b></p>
      <div data-vd-state="{ base: 100 }" class="card">
        an inner carrier shadows <code>base</code>: <b data-vd-text="base"></b> —
        while <code>double</code> still resolves upward: <b data-vd-text="double"></b>
      </div>
    </div>
  </demo-block>
  <demo-block caption="@key is the page-global store — two islands, no shared ancestor, one number.">
    <div class="card" data-vd-state="{ _island: 1 }">
      island one <button data-vd-on-click="{ @tally: (@tally ? @tally : 0) + 1 }">+1</button>
    </div>
    <div class="card" data-vd-state="{ _island: 2 }">
      island two sees <b data-vd-text="@tally ? @tally : 0"></b>
    </div>
  </demo-block>
  <h2>Reflections — text, show, class, style</h2>
  <demo-block caption="One write, four surfaces. show toggles [hidden]; a null style value removes the property.">
    <div data-vd-state="{ open: false, qty: 3, price: 40 }">
      <button data-vd-on-click="{ open: !open }">toggle</button>
      <nav data-vd-show="open" data-vd-class="{ is-open: open }">now you see me</nav>
      <p data-vd-class="{ bulk: qty * price > 100 }">
        order total <b data-vd-text="qty * price"></b>
        <button data-vd-on-click="{ qty: qty + 1 }">more</button>
      </p>
      <p data-vd-style="{ opacity: open ? 1 : 0.35, color: open ? 'seagreen' : null }">styled by state</p>
    </div>
  </demo-block>
  <h2>bind-* — attributes and live form properties</h2>
  <demo-block caption="false/null removes; true is present-empty; aria-* stringifies; value/checked write the LIVE property. href is refused outright — see Diagnostics.">
    <div data-vd-state="{ open: false, note: 'editable from state' }">
      <button data-vd-bind-aria-expanded="open" data-vd-bind-disabled="!open">
        disabled until opened
      </button>
      <button data-vd-on-click="{ open: !open }">flip it</button>
      <br /><input data-vd-bind-value="note" size="30" />
      <button data-vd-on-click="{ note: 'reset by a click' }">reset the input</button>
    </div>
  </demo-block>
  <h2>Components and directives share one world</h2>
  <demo-block caption="A vera COMPONENT subscribing to a DIRECTIVE's store via core's hooks — substrate adoption, live, on the production bundles.">
    <div data-vd-state="{ n: 10 }">
      <button data-vd-on-click="{ n: n - 1 }">−</button>
      <b data-vd-text="n"></b>
      <button data-vd-on-click="{ n: n + 1 }">+</button>
      <p><mirror-count></mirror-count></p>
    </div>
  </demo-block>
  <h2>Churn is free</h2>
  <demo-block caption="Markup inserted at ANY time activates fully; removal tears down completely. The buttons below are plain JS doing innerHTML — the engine does the rest.">
    <churn-lab></churn-lab>
  </demo-block>
`;

const EVENTS = `
  <h2>The on-* family — one delegated listener per type, page-wide</h2>
  <demo-block caption="A handler is a braced assignments object, re-read at dispatch — swapped-in markup works from its first event.">
    <div data-vd-state="{ n: 0 }">
      <button data-vd-on-click="{ n: n + 1 }">click</button>
      <button data-vd-on-dblclick="{ n: n + 10 }">double-click</button>
      <span class="pill" data-vd-text="n"></span>
    </div>
  </demo-block>
  <demo-block caption="Key guards: -enter fires only on Enter; the bare form fires on everything. Try both keys in each field.">
    <div data-vd-state="{ sent: 0, keys: 0 }">
      <input placeholder="Enter counts here" data-vd-on-keydown-enter="{ sent: sent + 1 }" />
      <input placeholder="every key counts here" data-vd-on-keydown="{ keys: keys + 1 }" />
      <p>enters <b data-vd-text="sent"></b> · keys <b data-vd-text="keys"></b></p>
    </div>
  </demo-block>
  <demo-block caption="outside-click lives on the CONTAINER (composedPath decides in/out); escape listens on the document.">
    <div data-vd-state="{ open: false }">
      <button data-vd-on-click="{ open: true }">open the panel</button>
      <nav class="card" data-vd-show="open" data-vd-on-outside-click="{ open: false }">
        click anywhere OUTSIDE me — or press
        <span data-vd-on-escape="{ open: false }">Escape</span> — to close
      </nav>
    </div>
  </demo-block>
  <demo-block caption="Window and document targets, with the same key grammar. Scroll this page a little.">
    <div data-vd-state="{ scrolls: 0, spaces: 0 }">
      <p data-vd-on-window-scroll="{ scrolls: scrolls + 1 }">
        window scrolls seen: <b data-vd-text="scrolls"></b>
      </p>
      <p data-vd-on-document-keydown-space="{ spaces: spaces + 1 }">
        spacebar presses anywhere: <b data-vd-text="spaces"></b>
      </p>
    </div>
  </demo-block>
  <demo-block caption="on-load runs AT ACTIVATION — deterministic whether the pack loaded early or late. Route back and forth: it re-runs per activation, and the @ store remembers.">
    <p data-vd-on-load="{ @visits: (@visits ? @visits : 0) + 1 }">
      this paragraph has been activated <b data-vd-text="@visits ? @visits : 0"></b> time(s)
    </p>
  </demo-block>
  <demo-block caption="submit prevents by default; submit-native is the day-one opt-out.">
    <div data-vd-state="{ guarded: 0 }">
      <form data-vd-on-submit="{ guarded: guarded + 1 }">
        <button>submit (stays on the page)</button>
        <span class="pill" data-vd-text="guarded"></span>
      </form>
    </div>
  </demo-block>
  <p class="lede">An honest limit, stated rather than hidden: handlers are assignment objects, so
  they see state — not the event object. The moment a demo needs <code>event.clientX</code>, it
  has crossed into component territory, and components are one <code>init(this)</code> away.</p>
`;

const EXPRESSIONS = `
  <h2>The expression tier — CSP-safe, deterministic, calm</h2>
  <demo-block caption="No eval, no Function — a thunk compiler with strict equality and JS truthiness.">
    <div data-vd-state="{ a: 7, b: 3, name: 'vera' }">
      <p>arithmetic: <b data-vd-text="a * b + 1"></b> · ternary:
      <b data-vd-text="a > b ? 'a wins' : 'b wins'"></b></p>
      <p>strings: <b data-vd-text="upper(name)"></b> has <b data-vd-text="len(name)"></b> letters</p>
      <p>PURE functions only — <code>round</code>, <code>abs</code>, <code>min</code>,
      <code>max</code>, <code>floor</code>, <code>ceil</code>, <code>len</code>,
      <code>upper</code>, <code>lower</code>: <b data-vd-text="round(a / b)"></b></p>
    </div>
  </demo-block>
  <demo-block caption="CALM MATH: undefined, NaN and division never throw a page. Absence is falsy; !missing is the absence idiom.">
    <div data-vd-state="{ x: 0 }">
      <p>1 / x where x is 0: <b data-vd-text="1 / x"></b> — rendered, not thrown</p>
      <p>an unknown key reads as undefined: <b data-vd-text="ghost"></b>
      <span data-vd-show="!ghost">(and !ghost is how you ask "is it absent")</span></p>
    </div>
  </demo-block>
  <demo-block caption="Comparisons drive everything — the tier upgrades every value class on the page.">
    <div data-vd-state="{ score: 45 }">
      <input type="range" min="0" max="100" data-vd-sync="score" />
      <b data-vd-text="score"></b>
      <p data-vd-class="{ bulk: score >= 80 }"
         data-vd-text="score >= 80 ? 'critical' : score >= 50 ? 'warm' : 'calm'"></p>
    </div>
  </demo-block>
  <p class="lede">Strictness is a feature: <code>==</code> is strict here, and writing
  <code>===</code> is refused with a teaching message — see it live on the Diagnostics page.</p>
`;

const WIDGETS = `
  <h2>Forms that remember — sync and persist</h2>
  <demo-block caption="sync is control-aware two-way binding; persist survives a reload (try one). The literal names the KEY — it is never evaluated.">
    <div data-vd-state="{ draft: 'type, reload, still here', fruit: 'plum', loud: false }"
         data-vd-persist="draft">
      <input size="28" data-vd-sync="draft" />
      <p>echo: <i data-vd-text="draft"></i></p>
      <select data-vd-sync="fruit">
        <option>plum</option><option>fig</option><option>yuzu</option>
      </select>
      <label><input type="checkbox" data-vd-sync="loud" /> loud</label>
      <b data-vd-text="loud ? upper(fruit) : fruit"></b>
    </div>
  </demo-block>
  <h2>Focus, as a policy</h2>
  <demo-block caption="focus-on moves focus when its expression turns true; focus-trap cycles Tab inside; focus-return sends it back on teardown.">
    <div data-vd-state="{ open: false }">
      <button data-vd-focus-return data-vd-on-click="{ open: true }">open the dialog</button>
      <div class="modal" data-vd-show="open">
        <div data-vd-focus-trap>
          <h3>Tab is trapped in here</h3>
          <input placeholder="first" data-vd-focus-on="open" />
          <input placeholder="second" />
          <button data-vd-on-click="{ open: false }">close (focus returns to the opener)</button>
        </div>
      </div>
    </div>
  </demo-block>
  <h2>The document as a surface</h2>
  <demo-block caption="doc-class writes classes on <html> (this page's blur-the-world rule is CSS on html.has-modal); scroll-lock is ref-counted across every locker.">
    <div data-vd-state="{ frozen: false }">
      <label><input type="checkbox" data-vd-sync="frozen" /> freeze page scroll + blur the world</label>
      <i data-vd-doc-class="{ has-modal: frozen }" data-vd-scroll-lock="frozen"></i>
    </div>
  </demo-block>
  <h2>Small utilities that earn their bytes</h2>
  <demo-block caption="copy takes its value (or the element's text) to the clipboard; scroll-to smooth-scrolls to a selector; every runs assignments on intervals — keys are the milliseconds.">
    <div data-vd-state="{ beats: 0 }">
      <button data-vd-copy="npm i @verajs/directives">copy the install line</button>
      <button data-vd-scroll-to="header">back to the top</button>
      <p data-vd-every="{ 1000: { beats: beats + 1 } }">
        alive for <b data-vd-text="beats"></b>s on this visit
      </p>
    </div>
  </demo-block>
`;

const MOTION = `
  <h2>data-vd-motion — one attribute, the whole animation</h2>
  <p class="lede">Scroll this page slowly. Presets are the everyday spelling; the object is the
  full grammar: keyframes as <code>'position value'</code> pairs, settings beside them,
  per-property easing in the nested form.</p>
  <div class="tall-space">↓ scroll — everything below is scroll-driven ↓</div>
  <demo-block caption="The ten presets. A preset expands to ordinary keyframes — never a special case.">
    <div style="display:flex; flex-wrap:wrap; gap:0.9rem">
      <div class="hero-box" data-vd-motion="fade">fade</div>
      <div class="hero-box" data-vd-motion="fade-up">fade-up</div>
      <div class="hero-box" data-vd-motion="fade-down">fade-down</div>
      <div class="hero-box" data-vd-motion="fade-left">fade-left</div>
      <div class="hero-box" data-vd-motion="fade-right">fade-right</div>
      <div class="hero-box" data-vd-motion="zoom-in">zoom-in</div>
      <div class="hero-box" data-vd-motion="zoom-out">zoom-out</div>
      <div class="hero-box" data-vd-motion="slide-up">slide-up</div>
      <div class="hero-box" data-vd-motion="slide-down">slide-down</div>
      <div class="hero-box" data-vd-motion="blur-in">blur-in</div>
    </div>
  </demo-block>
  <demo-block caption="The object form: multiple properties, each on its own keyframes; number sugar (opacity: 1 means 'to 1'); element settings inline.">
    <div class="hero-box"
         data-vd-motion="{ opacity: '0% 0, 60% 1', rotate: '0% -12deg, 100% 0deg',
                           translate-y: '0% 70px, 100% 0px', inertia: 0.25 }">
      composed
    </div>
  </demo-block>
  <demo-block caption="Per-property easing — the nested form. rotate spins on ease-in while opacity stays linear; a cubic-bezier with y past 1 overshoots and settles.">
    <div class="hero-box"
         data-vd-motion="{ opacity: '0% 0, 40% 1',
                           rotate: { frames: '0% 180deg, 100% 0deg', ease: 'ease-in' },
                           translate-y: { frames: '0% 90px, 100% 0px', ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' } }">
      eased
    </div>
  </demo-block>
  <demo-block caption="Width bands merge over the base ([0-560]: less travel on a phone) — and a registered breakpoint name is a key suffix: translate-y-phone. Resize to watch.">
    <div class="hero-box"
         data-vd-motion="{ translate-x: '0% 160px, 100% 0px; [0-560]: 0% 40px, 100% 0px',
                           opacity-wide: '0% 0.5, 100% 1' }">
      responsive
    </div>
  </demo-block>
  <demo-block caption="stagger goes on the PARENT; each child's keyframes shift by index × step. Remove one card mid-scroll and the cascade re-forms — indices are live.">
    <div data-vd-motion="{ stagger: '12%' }" style="display:flex; gap:0.9rem">
      <div class="hero-box" data-vd-motion="fade-up">1st</div>
      <div class="hero-box" data-vd-motion="fade-up">2nd</div>
      <div class="hero-box" data-vd-motion="fade-up">3rd</div>
      <div class="hero-box" data-vd-motion="fade-up">4th</div>
    </div>
  </demo-block>
  <demo-block caption="run-once plays through and LATCHES — scroll it in, then back up: it stays. The latch even survives attribute edits.">
    <div class="hero-box" data-vd-motion="{ opacity: '0% 0, 100% 1', scale: '0% 0.6, 100% 1', run-once: true }">
      latched
    </div>
  </demo-block>
  <h2>when — the selector driver</h2>
  <demo-block caption="when REPLACES the scroll driver: matched sits at the end, unmatched at the start, inertia carries the change. Pair it with state + on-click and you have UI transitions with no new machinery.">
    <div data-vd-state="{ lit: false }">
      <button data-vd-on-click="{ lit: !lit }">toggle</button>
      <div class="hero-box" data-vd-class="{ lit: lit }"
           data-vd-motion="{ opacity: '0% 0.25, 100% 1', scale: '0% 0.8, 100% 1',
                             rotate: '0% 0deg, 100% 360deg', when: '.lit', inertia: 0.5 }">
        state-driven
      </div>
    </div>
  </demo-block>
  <h2>Regions — motion-config replaces instances</h2>
  <demo-block caption="A container with motion-config is its own scroll world: this rail is a HORIZONTAL region with its own scroller. Scroll it sideways.">
    <div id="rail" class="gallery" data-vd-motion-config="{ axis: 'horizontal', scroller: '#rail', inertia: 0 }">
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">A</div>
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">B</div>
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">C</div>
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">D</div>
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">E</div>
      <div class="hero-box" data-vd-motion="{ rotate: '0% -20deg, 100% 20deg', opacity: '0% 0.3, 50% 1, 100% 0.3' }">F</div>
    </div>
  </demo-block>
  <demo-block caption="The authoring escape hatch: explicit enable/disable wins over the reduced-motion preference (a page that never calls these honours the visitor's setting).">
    <div data-vd-state="{ _controls: 1 }">
      <button id="motion-off">disableMotion()</button>
      <button id="motion-on">enableMotion()</button>
    </div>
  </demo-block>
  <div class="tall-space">the vocabulary continues on the Motion&nbsp;vocab page →</div>
`;

const VOCAB = `
  <h2>paint — colour, gradients, shadows</h2>
  <p class="lede">Nothing here is interpolated by hand: each authored value takes a slot, the
  curve steps between slots, and the CSS transition (inertia) carries the change. The engine is
  the parser — <code>CSS.supports</code> — and the image-sourcing family is refused wholesale.</p>
  <div class="tall-space">↓ scroll ↓</div>
  <demo-block caption="A sky, by scroll: background bands through dawn. shadow and color ride along.">
    <div class="hero-box" style="width:100%; height:9rem"
         data-vd-motion="{ background: '0% #1a1a2e, 35% #6246ea, 70% #ff8e6e, 100% #ffd97d',
                           color: '0% #ffffff, 70% #1a1a2e',
                           shadow: '0% 0 0 0 rgba(0,0,0,0), 100% 0 18px 40px rgba(98,70,234,0.45)',
                           inertia: 0.35 }">
      dawn
    </div>
  </demo-block>
  <h2>path — follow an SVG path</h2>
  <demo-block caption="path animates offset-distance along the &lt;path&gt; named by path-selector (resolved in the element's own root — shadow-safe). path-rotate: auto follows the tangent.">
    <svg class="trail" viewBox="0 0 600 130" aria-hidden="true">
      <path id="wave" d="M 20 100 C 150 -20, 300 180, 420 40 S 560 90, 585 30"
            fill="none" stroke="var(--soft)" stroke-width="3" />
    </svg>
    <div class="rider"
         data-vd-motion="{ path: '0% 0, 100% 100', path-selector: '#wave', path-rotate: 'auto', inertia: 0.2 }"></div>
  </demo-block>
  <h2>split — text in pieces</h2>
  <demo-block caption="split rewrites the text; each piece inherits the element's motion (minus stagger, which stays on the host and cascades the pieces). A visually-hidden copy keeps the sentence for screen readers.">
    <p class="poem" data-vd-split="words"
       data-vd-motion="{ opacity: '0% 0, 100% 1', translate-y: '0% 26px, 100% 0px',
                         blur: '0% 6px, 100% 0px', stagger: '9%' }">
      every word arrives on its own little breath of scroll
    </p>
  </demo-block>
  <demo-block caption="chars splits by grapheme cluster (Intl.Segmenter) — an emoji family is ONE piece, not five broken glyphs.">
    <p class="poem" data-vd-split="chars"
       data-vd-motion="{ rotate: '0% 90deg, 100% 0deg', opacity: '0% 0, 100% 1', stagger: '4%' }">
      vera 👨‍👩‍👧‍👦 splits
    </p>
  </demo-block>
  <h2>sequence — scroll-scrubbed image frames</h2>
  <demo-block caption="A canvas scrubbed through numbered frames as you scroll. The URL policy is FACTORY-ONLY — an attribute can never widen the origin allowlist; this one stays same-origin and is refused live because no frames are served here. That refusal (below, and on the Diagnostics page) is the feature: nothing fails silently.">
    <canvas width="320" height="180" class="card"
            data-vd-motion="{ frame: '0% 0, 100% 24', frame-url: '/examples/directives/frames/',
                              frame-count: 24, frame-ext: 'webp', frame-tween: true }"></canvas>
  </demo-block>
  <h2>easings</h2>
  <demo-block caption="The easings module resolves keywords, cubic-bezier() and steps() for the CURVE (evaluated per segment, like @keyframes). inertia-ease shapes the catch-up and is CSS's job — same vocabulary, different physics.">
    <div style="display:flex; gap:0.9rem; flex-wrap:wrap">
      <div class="hero-box" data-vd-motion="{ translate-y: '0% 80px, 100% 0px', ease: 'linear' }">linear</div>
      <div class="hero-box" data-vd-motion="{ translate-y: '0% 80px, 100% 0px', ease: 'ease-in-out' }">ease-in-out</div>
      <div class="hero-box" data-vd-motion="{ translate-y: '0% 80px, 100% 0px', ease: 'steps(5)' }">steps(5)</div>
      <div class="hero-box" data-vd-motion="{ translate-y: '0% 80px, 100% 0px', ease: 'cubic-bezier(0.34, 1.8, 0.64, 1)' }">springy</div>
    </div>
  </demo-block>
  <div class="tall-space">— end of the vocabulary —</div>
`;

const FUN = `
  <h2>Recipes nobody had to build a feature for</h2>
  <demo-block caption="THE THEME LAB — doc-class + sync + persist: a dark mode in three attributes, remembered across reloads. (This whole page obeys it.)">
    <div data-vd-state="{ dark: false }" data-vd-persist="dark">
      <label><input type="checkbox" data-vd-sync="dark" /> night mode</label>
      <i data-vd-doc-class="{ night: dark }"></i>
    </div>
  </demo-block>
  <demo-block caption="DISCO — every + class cycling through a palette. State machines by arithmetic: step wraps with calm math.">
    <div data-vd-state="{ step: 0, on: false }">
      <label><input type="checkbox" data-vd-sync="on" /> disco</label>
      <span data-vd-show="on" data-vd-every="{ 350: { step: (step + 1) - floor((step + 1) / 4) * 4 } }"></span>
      <div class="hero-box"
           data-vd-style="{ background: step == 0 ? '#6246ea' : step == 1 ? '#e63946' : step == 2 ? '#0a7d4f' : '#ff8e6e' }"
           data-vd-text="on ? '♪' : 'off'"></div>
    </div>
  </demo-block>
  <demo-block caption="ARROW HERO — window-level keyed events lighting a row; Escape resets. Press ↑ ↓ ← → anywhere.">
    <div class="konami-row" data-vd-state="{ u: 0, d: 0, l: 0, r: 0 }"
         data-vd-on-window-keydown-arrow-up="{ u: u + 1 }"
         data-vd-on-window-keydown-arrow-down="{ d: d + 1 }"
         data-vd-on-window-keydown-arrow-left="{ l: l + 1 }"
         data-vd-on-window-keydown-arrow-right="{ r: r + 1 }"
         data-vd-on-escape="{ u: 0, d: 0, l: 0, r: 0 }">
      <span data-vd-class="{ hit: u }">↑</span>
      <span data-vd-class="{ hit: d }">↓</span>
      <span data-vd-class="{ hit: l }">←</span>
      <span data-vd-class="{ hit: r }">→</span>
      <b data-vd-show="u > 0 ? d > 0 ? l > 0 ? r > 0 : false : false : false">— full compass! (Esc resets)</b>
    </div>
  </demo-block>
  <demo-block caption="ENTRANCE TRANSITIONS — the on-load + when recipe: activation writes state, the selector matches, inertia eases it in. Route away and back to replay.">
    <div data-vd-state="{ here: false }" data-vd-on-load="{ here: true }">
      <div class="hero-box" data-vd-class="{ lit: here }"
           data-vd-motion="{ opacity: '0% 0, 100% 1', translate-y: '0% 24px, 100% 0px',
                             when: '.lit', inertia: 0.6, inertia-ease: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }">
        hello
      </div>
    </div>
  </demo-block>
  <demo-block caption="THE HONESTY MIRROR — this very block: demo-block renders its children and prints them. The code below built the box above, byte for byte.">
    <div data-vd-state="{ meta: true }">
      <p data-vd-show="meta">you are reading a demo of the thing displaying this demo</p>
    </div>
  </demo-block>
`;

const DIAGNOSTICS = `
  <h2>Refusals are the interface</h2>
  <p class="lede">Nothing on this page throws at markup. Every mistake below is DELIBERATE, alive
  right now, and explained in the registry — the channel a GUI reads. The panel updates as you
  create refusals elsewhere (try the sequence canvas, or write junk in an attribute via devtools).</p>
  <demo-block caption="A gallery of intentional mistakes, each earning a sentence, none taking the page down.">
    <div data-vd-state="{ n: 1 }">
      <p data-vd-nope="x">an unknown directive</p>
      <p data-vd-show="{ broken">a value that cannot parse</p>
      <p data-vd-text="n === 1 ? 'x' : 'y'">=== gets the teaching refusal (== is already strict)</p>
      <a data-vd-bind-href="'javascript:alert(1)'">bind-href is refused wholesale — templates own URLs</a>
      <p data-vd-motion="{ opacity: fade }">an unquoted motion value</p>
      <p data-vd-motion="{ pin: 120px }">the unquoted-length paper cut — whole-element refusal, with the fix in the message</p>
      <svg data-vd-motion="fade"><rect width="10" height="10"></rect></svg>
    </div>
  </demo-block>
  <rejections-panel></rejections-panel>
`;

customElements.define('app-shell', class extends HTMLElement {
  connectedCallback() {
    this.innerHTML = `
      <header>
        <nav>
          <a route href="/">Overview</a>
          <a route href="/state">State &amp; binding</a>
          <a route href="/events">Events</a>
          <a route href="/expressions">Expressions</a>
          <a route href="/widgets">Widgets</a>
          <a route href="/motion">Motion</a>
          <a route href="/motion-vocab">Motion vocab</a>
          <a route href="/fun">Fun</a>
          <a route href="/diagnostics">Diagnostics</a>
        </nav>
      </header>
      <main view="main"></main>`;

    const appRouter = initRouter(this, { view: 'main' });
    appRouter.addRoutes([
      /** Static hosts (and the example sweep) open .../index.html — same page, canonical URL. */
      { path: '/index.html', redirect: '/' },
      { path: '/', title: 'VeraJS directives', component: () => page('Every directive, live', 'One engine, three vocabularies, no build step — and every demo shows the markup that made it.', HOME) },
      { path: '/state', title: 'State — vera directives', component: () => page('State, reflections, binding', 'The nouns: data-vd-state seeds context; reads resolve to the nearest owner; @keys are page-global.', STATE) },
      { path: '/events', title: 'Events — vera directives', component: () => page('The on-* family', 'One delegated listener per event type for the whole page — zero per-element listeners, and swapped-in markup just works.', EVENTS) },
      { path: '/expressions', title: 'Expressions — vera directives', component: () => page('The expression tier', 'Optional, additive, CSP-safe. Wire it and every value class on the page learns arithmetic.', EXPRESSIONS) },
      { path: '/widgets', title: 'Widgets — vera directives', component: () => page('Forms, focus, and the document', 'The behaviors that make pages feel finished — each one attribute.', WIDGETS) },
      { path: '/motion', title: 'Motion — vera directives', component: () => page('Motion', 'Scroll-driven (or selector-driven) animation in one attribute. This page is meant to be scrolled slowly.', MOTION) },
      { path: '/motion-vocab', title: 'Motion vocabulary — vera directives', component: () => page('The motion vocabulary', 'Wired modules extend the OBJECT — paint, path, split, sequence, easings teach data-vd-motion new keys, never new attributes.', VOCAB) },
      { path: '/fun', title: 'Fun — vera directives', component: () => page('The fun ones', 'Nothing on this page needed a feature — every toy is the same small grammar, composed.', FUN) },
      { path: '/diagnostics', title: 'Diagnostics — vera directives', component: () => page('Diagnostics', 'The refusal philosophy, live: every mistake is a sentence in a registry, and the page never breaks.', DIAGNOSTICS) },
      { path: '/*rest', title: 'Lost — vera directives', component: (params) => html`<h1>Nothing at /${params.rest}</h1><p><a route href="/">Back to the overview.</a></p>` },
    ]);

    /** The two motion escape hatches are plain functions — wired to plain buttons. */
    this.addEventListener('click', (event) => {
      const target = event.target;
      if (target?.id === 'motion-off') disableMotion();
      if (target?.id === 'motion-on') enableMotion();
    });
  }
});

/** Quietly prove settled() to anyone reading the console. */
await settled();
console.log('[demo] first activation settled —', rejections().length, 'deliberate refusal(s) so far');
