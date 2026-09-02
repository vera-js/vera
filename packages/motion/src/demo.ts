/**
 * Demo bootstrap (`demo.ts`, deliberately not the package entry — that is `index.ts`) — built with VeraJS, the framework this library is destined
 * for. Not part of the library: `npm run build`
 * builds src/index.ts, which imports nothing from Vera.
 *
 * Using Vera here is the integration test. It exercises three things a
 * hand-rolled demo cannot:
 *
 *   1. animation inside real web components, in real shadow roots
 *   2. survival of Vera's re-render, which replaces rendered DOM wholesale
 *   3. whether the two runtimes fight over the same nodes
 */
import { init, createStore, render, wire, html } from '@verajs/core';
import { renderer } from '@verajs/renderer';
import { createMotion, wireMotion } from './index.js';
/** The gradient-morph module the paint section wires — see its file's docblock. */
import { gradient } from './demo-gradient.js';
/** The class-toggle module the same section wires — see its file's docblock. */
import { classes } from './demo-classes.js';
/**
 * The demo scrubs two image sequences, and image sequences are a module now —
 * so the page has to wire one. It did not, from the refactor until this was
 * caught: the canvases drew nothing and `frame`, `frame-url` and `frame-count`
 * were reported as unknown attributes, in the demo — the page that doubles as
 * documentation.
 *
 * The acceptance test could not see it. `spikes/baseline.mjs` diffs *style*
 * cells against ground truth, and a canvas driven by `frame` writes no style —
 * it paints. So 2,415 cells matched while two of the demo's features were
 * dead. It reads every inline property the demo writes now (re-recorded as
 * sections were added; `node spikes/baseline.mjs` prints the live cell count
 * rather than this comment carrying one) — but a canvas is still outside what
 * a style diff can see, which is what `spikes/demo-sequence.mjs` is for.
 */
import { sequence } from './sequence.js';
import { path } from './path.js';
import { split } from './split.js';
import { paint } from './paint.js';
import { easings } from './easings.js';
import { createScrollTo } from './scroll-to.js';
import type { MotionInstance } from './index.js';

/** `setRenderer` was removed in core 0.2.0; the renderer module is wired like any other. */
wire([renderer as never]);

/* ------------------------------------------------------------- runtime -- */

let inertia = 0.1;
let respectReducedMotion = false;
let animation: MotionInstance;

/** Shadow roots belonging to Vera components, registered as they connect. */
const componentRoots = new Set<ShadowRoot>();

wireMotion([sequence, path, split, paint, easings, gradient, classes]);

/**
 * `rejected` is a getter that recomputes from the live state — an animation
 * the page is too short to finish stops being reported when the page grows —
 * so it is read when the panel renders rather than stored once.
 */
const reasons = (): string[] =>
  animation?.rejected.flatMap((entry) => entry.rejected) ?? [];

const build = (): MotionInstance => {
  const next = createMotion({ inertia, respectReducedMotion });
  next.init();
  for (const root of componentRoots) next.observe(root);
  return next;
};

const rebuild = (): void => {
  animation?.destroy();
  animation = build();
  panelState.enabled = animation.enabled;
  panelState.count = animation.elements.length;
  panelState.reduced = animation.reducedMotion;
  panelState.rejected = reasons();
};

/* ---------------------------------------------------------- components -- */

const panelState = createStore({
  enabled: true,
  count: 0,
  /** Every reason the instance is reporting, flattened for display. */
  rejected: [] as string[],
  reduced: false,
  /** The instance's actual default, or the slider and its label lie until first touched. */
  inertia: 0.1,
  respect: false,
  /** Collapsed on a phone, where the open panel covers most of the page. */
  open: typeof matchMedia === 'function' ? matchMedia('(min-width: 700px)').matches : true,
});

customElements.define(
  'vera-panel',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });

      render(
        () => html`
          <style>
            :host {
              position: fixed; bottom: 14px; right: 14px; z-index: 99999;
              width: 292px; display: block;
            }
            .collapse {
              position: absolute; top: 10px; right: 12px;
              border: 0; background: none; color: #8b8b98; cursor: pointer;
              font: 15px/1 ui-monospace, Menlo, monospace; padding: 2px 4px;
            }
            .collapse:hover { color: #f4f4f6; }
            .body[hidden] { display: none; }
            .panel {
              padding: 14px 16px; border-radius: 10px;
              background: rgba(18,18,20,.93); color: #f2f2f4;
              font: 12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace;
              backdrop-filter: blur(8px); box-shadow: 0 6px 28px rgba(0,0,0,.35);
            }
            .row { margin: 0 0 9px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
            .title { font-weight: 700; margin-bottom: 12px; }
            .hint { display: block; color: #9b9ba4; font-size: 11px; line-height: 1.5; }
            .hint b { color: #d6d6dc; }
            button {
              font: inherit; padding: 5px 12px; border-radius: 6px; cursor: pointer;
              border: 1px solid #4a4a55; background: #2a2a32; color: #f2f2f4;
            }
            button:hover { background: #35353f; }
            button.off { background: #7a2f2f; border-color: #a03d3d; }
            input[type=range] { flex: 1; min-width: 120px; }
            .stat { color: #7fd6a3; font-size: 11px; margin-top: 12px; padding-top: 10px; border-top: 1px solid #34343d; }
            .vera { color: #6ea8fe; }
          </style>

          <div class="panel">
            <button class="collapse" title="collapse"
              @click=${() => { panelState.open = !panelState.open; }}
            >${panelState.open ? '\u2212' : '+'}</button>

            <div class="row title">@verajs/motion <span class="vera">· VeraJS</span></div>

            <div class="body" ?hidden=${!panelState.open}>

            <div class="row">
              <button
                class=${panelState.enabled ? '' : 'off'}
                @click=${() => { animation.setEnabled(!animation.enabled); panelState.enabled = animation.enabled; }}
              >${panelState.enabled ? 'Disable' : 'Enable'}</button>
              <span class="hint">the editor's enable toggle</span>
            </div>

            <div class="row">
              <label>inertia <b>${panelState.inertia}</b>s</label>
              <input type="range" min="0" max="1.5" step="0.05" .value=${String(panelState.inertia)}
                @input=${(e: Event) => {
                  panelState.inertia = Number((e.target as HTMLInputElement).value);
                  inertia = panelState.inertia;
                  rebuild();
                }} />
            </div>
            <div class="row hint">
              Drag to <b>0</b> — the open question. Does zero inertia still read as skippy
              now the scroll loop is frame-aligned?
            </div>

            <div class="row">
              <label>
                <input type="checkbox" .checked=${panelState.respect}
                  @change=${(e: Event) => {
                    panelState.respect = (e.target as HTMLInputElement).checked;
                    respectReducedMotion = panelState.respect;
                    rebuild();
                  }} />
                respect <code>prefers-reduced-motion</code>
              </label>
            </div>
            <div class="row hint">
              If your OS asks for reduced motion, this stops everything.
              <b>Enable</b> still overrides it — the authoring escape hatch.
            </div>

            </div>

            <div class="row stat">
              ${panelState.count} elements · ${panelState.enabled ? 'running' : 'stopped'}
              ${panelState.reduced ? ' · reduced-motion honoured' : ''}
            </div>

            <!--
              What a GUI editor renders, and what the README tells anyone
              whose element is not animating to look at. The demo showed a count
              and a running/stopped flag and never this — so the page that
              doubles as documentation demonstrated every feature except the one
              that explains the others. It was not empty, either: the card below
              ran to 100% with nothing after it on the page, which the library
              had been reporting to nobody for as long as the demo has existed.
            -->
            <div class="row stat">
              ${panelState.rejected.length === 0
                ? 'rejected: nothing — every attribute took'
                : `rejected (${panelState.rejected.length}):`}
              ${panelState.rejected.map((line) => html`<span class="hint">${line}</span>`)}
            </div>
          </div>
        `
      );
    }
  }
);

/**
 * An animated card inside a Vera component. The counter exists to force
 * re-renders: Vera replaces rendered DOM, so this is where a stale element
 * reference would show up as an animation that stops working after a click.
 */
customElements.define(
  'vera-card',
  class extends HTMLElement {
    connectedCallback() {
      init(this, { mode: 'open' });
      const state = createStore({ clicks: 0 });

      render(
        () => html`
          <style>
            :host { display: block; }
            .card {
              padding: 44px; border-radius: 14px;
              background: #16161b; border: 1px solid #26262f; color: #f4f4f6;
              font: 16px/1.65 system-ui, -apple-system, sans-serif;
            }
            h3 { margin: 0 0 10px; font-size: 22px; letter-spacing: -.02em; }
            p { margin: 0 0 18px; color: #8b8b98; }
            code {
              font: 12.5px/1.7 ui-monospace, Menlo, monospace; color: #7fd6a3;
              background: rgba(127,214,163,.08); padding: 2px 6px; border-radius: 4px;
            }
            button {
              font: 13px/1 ui-monospace, Menlo, monospace; padding: 9px 16px;
              border-radius: 8px; cursor: pointer;
              border: 1px solid #3a3a46; background: #22222a; color: #f4f4f6;
            }
            button:hover { background: #2c2c36; }
          </style>

          <!--
            Ends at 60%, which is the demo's convention everywhere else and the
            shape a reveal wants: the card settles while it is on screen rather
            than while it is leaving. It ran to 100%, which for the last element
            on a page cannot be reached at all — the timeline gets there only
            once the element has completely left the scroll window, and nothing
            follows this. The library said so in its rejected list, in all three
            engines, and the panel below now shows what it says.
          -->
          <div class="card" data-vera-motion
               data-vera-motion-translate-y="0% 70px, 60% 0px"
               data-vera-motion-opacity="0% 0, 50% 1"
               data-vera-motion-radius-top-left="0% 70px, 60% 14px">
            <h3>Rendered by VeraJS, animated by @verajs/motion</h3>
            <p>
              This lives in a <code>ShadowRoot</code> created by Vera's <code>init()</code>.
              The runtime was handed the root with <code>observe()</code>.
            </p>
            <p>
              Each click replaces this DOM. If the animation keeps tracking afterwards, the
              mutation observer re-adopted the new node.
            </p>
            <button @click=${() => state.clicks++}>
              re-rendered ${state.clicks} ${state.clicks === 1 ? 'time' : 'times'}
            </button>
          </div>
        `
      );

      if (this.shadowRoot) {
        componentRoots.add(this.shadowRoot);
        /** The runtime may not exist yet on first upgrade; build() adopts it if so. */
        animation?.observe(this.shadowRoot);
      }
    }

    disconnectedCallback() {
      if (this.shadowRoot) {
        componentRoots.delete(this.shadowRoot);
        animation?.unobserve(this.shadowRoot);
      }
    }
  }
);

/* -------------------------------------------------------------- trigger -- */

/**
 * The only JavaScript the trigger demo needs: toggle a class. The runtime
 * notices and moves the animation to its other end.
 */
document.getElementById('trigger')?.addEventListener('click', (event) => {
  (event.currentTarget as HTMLElement).nextElementSibling?.classList.toggle('is-open');
});

/* --------------------------------------------------------------- start -- */

animation = build();
createScrollTo({ selector: 'header a[href*="#"]' }).init();

panelState.count = animation.elements.length;
panelState.enabled = animation.enabled;
panelState.rejected = reasons();

Object.assign(window, { get animation() { return animation; } });
