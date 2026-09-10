/**
 * Sequence — scroll-scrubbed image sequences, for the motion object.
 *
 * A vocabulary module that owns the `frame` key, the `frame-*` settings that
 * configure it, the URL policy those settings need, and the canvas drawing —
 * none of which the runtime knows about.
 *
 * A factory rather than a plain connector, because the URL policy is a page
 * decision: `sequence({ allowedOrigins: [...] })` is how a CDN is permitted,
 * and an attribute can never widen it. Calling is optional —
 * `wireDirectives([motion, sequence])` uses the same-origin default.
 *
 * The old `prepare`-insert staleness sweep (`decidedWith`/`settingsKey`,
 * which existed so an edited `frame-url` dropped its stale drawer on the
 * next collect) is GONE: the engine rebuilds the element on any value edit,
 * the `frame` key's `setup` teardown drops the drawer, and the next draw
 * rebuilds it from the fresh value. Structural, not swept.
 */
import { createSequence } from './frames.js';
import { parseUrl } from './url.js';
import { pageProblem } from './schema.js';
import type { SettingDef, WirableTree } from './schema.js';
import type { TickModule } from './ticks.js';
import { MOTION_ATTR } from './parse.js';
import { parseValue, isObject } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';

const FROM = '@verajs/directives/motion';

type Drawer = { draw(index: number): void; destroy(): void };

/**
 * One drawer per canvas, built on the first tick that asks for it — lazily,
 * so an element that never comes into view never allocates a decoder. The
 * frame count rides along because the tick receives PROGRESS (0-1) and the
 * drawer wants an index; the scaling needs the count without re-reading the
 * attribute per frame.
 */
const drawers = new Map<Element, { drawer: Drawer; frames: number }>();
/**
 * Canvases already refused, and why — reported through the element's own
 * refusal channel (captured at tick setup) where a GUI reads, besides the
 * console line.
 */
const refused = new Map<Element, string>();
/** Each active element's refusal channel, captured by the tick's `setup`. */
const rejecters = new Map<Element, (code: string, args?: readonly string[]) => void>();

const forget = (node: Element): void => {
  drawers.get(node)?.drawer.destroy();
  drawers.delete(node);
  /** The refusal record too, or a refused canvas outlives its own removal. */
  refused.delete(node);
};

/**
 * The element's frame-* settings, read from the ATTRIBUTE truth rather than
 * any stored record — a decoder must never be built from a url the policy
 * refused, and checking once, far away, is how that kind of hole opens. The
 * base grammar's cache makes the re-read one Map hit.
 */
const frameSettings = (node: Element): Readonly<Record<string, unknown>> => {
  const raw = node.getAttribute(MOTION_ATTR);
  if (raw === null || !raw.trimStart().startsWith('{')) return {};
  try {
    const parsed = parseValue(raw) as Parsed;
    if (isObject(parsed)) return parsed as ParsedObject;
  } catch {
    /* its activation already reported this */
  }
  return {};
};

const drawerFor = (
  node: HTMLElement,
  allowedOrigins: readonly string[]
): { drawer: Drawer; frames: number } | null => {
  const existing = drawers.get(node);
  if (existing) return existing;
  if (refused.has(node)) return null;

  const fail = (message: string): null => {
    refused.set(node, message);
    console.warn(`[vera] motion: ${message}`);
    /** The element's own diagnostics too — a console line is not a report a GUI can read. */
    rejecters.get(node)?.('motion-sequence-refused', [message]);
    return null;
  };

  if (!(node instanceof HTMLCanvasElement)) {
    return fail('frame needs a <canvas> element.');
  }

  const settings = frameSettings(node);
  /** Validated again HERE, against the policy — see `frameSettings`. */
  const url = parseUrl(String(settings['frame-url'] ?? ''), window.location.origin, allowedOrigins);
  if (!url) return fail('frame-url is missing or not permitted.');

  const frames = Number(settings['frame-count']);
  if (!Number.isFinite(frames) || frames < 1) {
    return fail('frame-count must be a positive number.');
  }

  const pad = Number(settings['frame-pad']);
  const ext = settings['frame-ext'];
  const tween = settings['frame-tween'] === true || settings['frame-tween'] === 'true';
  const drawer = createSequence(node, {
    /**
     * A frame that does not load is the failure this module is most likely
     * to produce: `frame-url` is a prefix — nothing enforces the trailing
     * slash — so one missing character 404s every fetch and the canvas
     * stays blank.
     */
    onFailure: (failed) => fail(`frame-url: nothing loaded, starting with ${failed}`),
    url,
    frames,
    ...(Number.isFinite(pad) && pad > 0 ? { pad } : {}),
    ...(typeof ext === 'string' && ext ? { ext } : {}),
    ...(tween ? { tween } : {}),
  });
  if (!drawer) return fail('this canvas has no 2D context.');

  const entry = { drawer, frames };
  drawers.set(node, entry);
  return entry;
};

export interface SequenceOptions {
  /**
   * Extra origins frames may be fetched from. Same-origin otherwise, and an
   * attribute can never widen it — the decision belongs to whoever wires
   * the module, not to the markup.
   */
  readonly allowedOrigins?: readonly string[];
}

/**
 * Normalised, and complained about when it cannot be. `parseUrl` compares
 * against `URL.origin` — scheme + host + port, never a trailing slash —
 * so three of the four ways a site owner plausibly writes an origin
 * matched nothing, each failing CLOSED (right) and silently (wrong).
 * `new URL(entry).origin` accepts those spellings and rejects a bare
 * host, which cannot be resolved without guessing a scheme — not a favour
 * to do silently on a security boundary. A lone string is refused rather
 * than wrapped: two ways to write one thing is how a list of one and a
 * list of many stop agreeing.
 *
 * Its own function so the ROWS and the TICK normalise ONCE from one options
 * object — two passes would double every complaint and could drift.
 */
const normalizeOrigins = (options: SequenceOptions): readonly string[] => {
  const declared = options.allowedOrigins;
  if (declared !== undefined && !Array.isArray(declared)) {
    pageProblem('motion-sequence-origins-not-list', [typeof declared]);
  }
  return (Array.isArray(declared) ? declared : []).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      pageProblem('motion-sequence-origin-not-url', [JSON.stringify(entry)]);
      return [];
    }
  });
};

const rowsFor = (allowedOrigins: readonly string[]): WirableTree => {
  const settings: readonly SettingDef[] = [
    {
      key: 'frame-url',
      from: FROM,
      type: 'string',
      /** The module's own origin policy — the runtime carries none. */
      parse: (raw) => parseUrl(raw, window.location.origin, allowedOrigins),
    },
    /** How many frames the sequence has. The cap is what a sane sequence could be. */
    { key: 'frame-count', from: FROM, type: 'number', min: 1, max: 10000 },
    /** Zero-padding width of the frame number in the filename. */
    { key: 'frame-pad', from: FROM, type: 'number', min: 1, max: 12 },
    /**
     * Frame file extension. An allowlist rather than free text: this is
     * concatenated into a url, and it is the whole point of the setting
     * that only real image formats appear there.
     */
    { key: 'frame-ext', from: FROM, type: 'string', allowed: ['jpg', 'jpeg', 'png', 'webp', 'avif'] },
    /**
     * Opt-in, not automatic. Whether stepping is visible depends on frames
     * per unit of scroll — a quantity that changes with the viewport, and
     * choosing from it would make the same markup behave differently on two
     * screens, silently.
     */
    { key: 'frame-tween', from: FROM, type: 'boolean' },
  ];

  return [...settings];
};

/** The vocabulary rows for one policy — the artifact generator's door. */
export const sequenceRows = (options: SequenceOptions = {}): WirableTree =>
  rowsFor(normalizeOrigins(options));

/** Rows and tick from ONE normalisation — what the wirable `sequence` installs. */
export const sequenceModule = (
  options: SequenceOptions = {}
): { rows: WirableTree; tick: TickModule } => {
  const origins = normalizeOrigins(options);
  return { rows: rowsFor(origins), tick: sequenceTick(origins) };
};

/**
 * The tick — sequence's whole runtime, since stage 6: an ordinary consumer of
 * the named-JS door, drawing a canvas frame from the number like any other
 * tick. Progress scales to a frame index here (`p * (frames - 1)`); tweening
 * between frames stays the drawer's business and stays opt-in.
 *
 * `setup` captures the element's refusal channel (so a wrong `frame-url`
 * reports where a GUI reads) and its teardown drops the drawer — the
 * engine's rebuild-on-edit is the staleness story, exactly as it was when a
 * `PropertyDef.setup` carried this.
 */
const sequenceTick = (allowedOrigins: readonly string[]): TickModule => ({
  setup(node, _settings, reject) {
    rejecters.set(node, reject);
    return () => {
      rejecters.delete(node);
      forget(node);
    };
  },
  tick(node, progress) {
    const entry = drawerFor(node, allowedOrigins);
    if (entry) entry.drawer.draw(progress * (entry.frames - 1));
  },
});
