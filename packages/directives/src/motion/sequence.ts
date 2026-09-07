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
import type { PropertyDef, SettingDef, WirableTree } from './schema.js';
import { MOTION_ATTR } from './parse.js';
import { parseValue, isObject } from '../parse.js';
import type { Parsed, ParsedObject } from '../parse.js';

const FROM = '@verajs/directives/motion';

type Drawer = { draw(index: number): void; destroy(): void };

/**
 * One drawer per canvas, built on the first frame that asks for it — lazily,
 * so an element that never comes into view never allocates a decoder.
 */
const drawers = new Map<Element, Drawer>();
/**
 * Canvases already refused, and why — `apply` hands the reason to the
 * runtime, which records it against the element where a GUI reads.
 */
const refused = new Map<Element, string>();

const forget = (node: Element): void => {
  drawers.get(node)?.destroy();
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

const drawerFor = (node: HTMLElement, allowedOrigins: readonly string[]): Drawer | null => {
  const existing = drawers.get(node);
  if (existing) return existing;
  if (refused.has(node)) return null;

  const fail = (message: string): null => {
    refused.set(node, message);
    console.warn(`[vera] motion: ${message}`);
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

  drawers.set(node, drawer);
  return drawer;
};

export interface SequenceOptions {
  /**
   * Extra origins frames may be fetched from. Same-origin otherwise, and an
   * attribute can never widen it — the decision belongs to whoever wires
   * the module, not to the markup.
   */
  readonly allowedOrigins?: readonly string[];
}

/** The vocabulary rows for one policy. `sequence` (below) wraps this as the wirable. */
export const sequenceRows = (options: SequenceOptions = {}): WirableTree => {
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
   */
  const declared = options.allowedOrigins;
  if (declared !== undefined && !Array.isArray(declared)) {
    pageProblem('motion-sequence-origins-not-list', [typeof declared]);
  }
  const allowedOrigins = (Array.isArray(declared) ? declared : []).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      pageProblem('motion-sequence-origin-not-url', [JSON.stringify(entry)]);
      return [];
    }
  });

  /**
   * Frame index within an image sequence. Drives a canvas rather than a
   * style, so it carries no `cssProperty` — the runtime routes it to this
   * module's `apply` instead.
   */
  const frame: PropertyDef = {
    key: 'frame',
    from: FROM,
    category: 'image',
    defaultUnit: '',
    units: [''],
    min: 0,
    initial: 0,
    /** The engine's rebuild is the edit path: teardown drops the drawer,
     *  the next draw rebuilds from the fresh value. */
    setup(node) {
      return () => forget(node);
    },
    /** No cssProperty: this paints a canvas rather than writing a style. */
    apply(node, value) {
      const drawer = drawerFor(node, allowedOrigins);
      /**
       * Drawn *and* asked whether anything has been refused since — a
       * sequence that built a drawer and then failed every fetch (the
       * likeliest shape of a wrong frame-url) reports through the same
       * channel. Returned every frame it stays refused; deduplication
       * lives with the recorder, the only place that sees every reporter.
       */
      if (drawer) drawer.draw(value);
      return refused.get(node);
    },
  };

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

  return [frame, ...settings];
};
