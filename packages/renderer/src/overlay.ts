/**
 * The profiler's in-page panel — live counts and the current churn list, in the corner of the app
 * you are already clicking through.
 *
 * Three constraints shaped this:
 *
 * 1. **It must not render itself with the renderer.** Doing so would fold the overlay's own
 *    commits into the numbers it reports. Everything here is plain DOM, updated in place.
 * 2. **It must not restyle the app.** It lives in a closed shadow root and sets every property it
 *    depends on, so neither direction leaks.
 * 3. **It must work with no toolchain**, like everything else here — no CSS file, no framework,
 *    one import.
 */
import type { ProfileReport } from './profiler.js';

export interface OverlayOptions {
  /** Corner to pin to. Default `bottom-right`. */
  corner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** How often to repaint, in milliseconds. Default 400. */
  interval?: number;
  /** Churn rows to show before collapsing the rest into a count. Default 4. */
  rows?: number;
}

const CSS = `
:host { all: initial; }
.panel {
  position: fixed; z-index: 2147483647;
  font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #e6edf3; background: #0d1117ee; border: 1px solid #30363d; border-radius: 6px;
  box-shadow: 0 8px 24px #0008; width: 340px; max-width: calc(100vw - 24px);
  backdrop-filter: blur(6px);
}
.bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; cursor: default; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #3fb950; flex: none; }
.dot.idle { background: #6e7681; }
.title { font-weight: 600; letter-spacing: .02em; flex: 1; }
button {
  font: inherit; color: #e6edf3; background: #21262d; border: 1px solid #30363d;
  border-radius: 4px; padding: 1px 7px; cursor: pointer;
}
button:hover { background: #30363d; }
.body { padding: 0 8px 8px; }
.stats { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; margin-bottom: 6px; }
.stats b { font-weight: 600; }
.warn { color: #f0883e; }
.good { color: #3fb950; }
.churn { border-top: 1px solid #30363d; padding-top: 6px; }
.churn h4 { margin: 0 0 4px; font-size: 11px; font-weight: 600; color: #f0883e; }
.row { margin-bottom: 5px; }
.where { color: #8b949e; }
.tpl { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.from { color: #ff7b72; }
.to { color: #7ee787; }
.hint { color: #8b949e; border-top: 1px solid #30363d; padding-top: 5px; margin-top: 2px; }
.empty { color: #8b949e; }
.collapsed .body { display: none; }
`;

const CORNERS: Record<string, string> = {
  'top-left': 'top:12px;left:12px;',
  'top-right': 'top:12px;right:12px;',
  'bottom-left': 'bottom:12px;left:12px;',
  'bottom-right': 'bottom:12px;right:12px;',
};

/**
 * Mounts the panel and returns a function that removes it. Requires a DOM, so it is a no-op
 * (returning a no-op) anywhere without one.
 */
export const mountOverlay = (
  read: () => ProfileReport,
  isActive: () => boolean,
  control: { start: () => void; stop: () => void },
  options: OverlayOptions = {}
): (() => void) => {
  if (typeof document === 'undefined' || document.body === null) return () => {};

  const { corner = 'bottom-right', interval = 400, rows = 4 } = options;

  const host = document.createElement('div');
  /**
   * Open, not closed. Style isolation is the same either way; closed only blocks script access,
   * which for a development tool costs more than it buys — you want to inspect this in devtools,
   * and it is what makes the panel testable.
   */
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('style', CORNERS[corner] ?? CORNERS['bottom-right']);
  panel.innerHTML =
    '<div class="bar">' +
    '<span class="dot"></span><span class="title">renderer profiler</span>' +
    '<button data-act="toggle">stop</button>' +
    '<button data-act="reset">reset</button>' +
    '<button data-act="fold">–</button>' +
    '</div>' +
    '<div class="body"><div class="stats"></div><div class="churn"></div></div>';

  root.append(style, panel);
  document.body.appendChild(host);

  const dot = panel.querySelector('.dot') as HTMLElement;
  const stats = panel.querySelector('.stats') as HTMLElement;
  const churn = panel.querySelector('.churn') as HTMLElement;
  const toggle = panel.querySelector('[data-act="toggle"]') as HTMLButtonElement;
  const fold = panel.querySelector('[data-act="fold"]') as HTMLButtonElement;

  const escape = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const paint = () => {
    const report = read();
    const running = isActive();
    dot.className = running ? 'dot' : 'dot idle';
    toggle.textContent = running ? 'stop' : 'start';

    const commits = report.updates + report.creates + report.rebuilds;
    const share = commits === 0 ? 0 : Math.round((report.rebuilds / commits) * 100);
    stats.innerHTML =
      `<span>frames</span><b>${report.frames}</b>` +
      `<span>time in render</span><b>${report.ms.toFixed(1)}ms</b>` +
      `<span>slowest frame</span><b>${report.slowestFrameMs.toFixed(1)}ms</b>` +
      `<span>updated in place</span><b class="good">${report.updates}</b>` +
      `<span>created</span><b>${report.creates}</b>` +
      `<span>rebuilt</span><b class="${report.rebuilds > 0 ? 'warn' : ''}">` +
      `${report.rebuilds}${commits > 0 ? ` (${share}%)` : ''}</b>`;

    if (report.churn.length === 0) {
      churn.innerHTML =
        commits === 0
          ? '<div class="empty">No renders recorded yet.</div>'
          : '<div class="empty good">No template churn — every commit updated in place.</div>';
      return;
    }
    const shown = report.churn.slice(0, rows);
    const hidden = report.churn.length - shown.length;
    churn.innerHTML =
      '<h4>Torn down, not updated</h4>' +
      shown
        .map(
          (entry) =>
            `<div class="row"><div class="where">${entry.count}× at ${escape(entry.where)}</div>` +
            `<div class="tpl from">${escape(entry.from)}</div>` +
            `<div class="tpl to">→ ${escape(entry.to)}</div></div>`
        )
        .join('') +
      (hidden > 0 ? `<div class="where">+${hidden} more</div>` : '') +
      '<div class="hint">Prefer one stable template with <b>?hidden=${…}</b> over swapping subtrees.</div>';
  };

  panel.addEventListener('click', (event) => {
    const act = (event.target as HTMLElement)?.dataset?.act;
    if (act === 'toggle') {
      if (isActive()) control.stop();
      else control.start();
    } else if (act === 'reset') control.start();
    else if (act === 'fold') {
      const folded = panel.classList.toggle('collapsed');
      fold.textContent = folded ? '+' : '–';
    }
    paint();
  });

  paint();
  const timer = setInterval(paint, interval);

  return () => {
    clearInterval(timer);
    host.remove();
  };
};
