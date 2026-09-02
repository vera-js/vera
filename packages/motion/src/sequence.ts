/**
 * `@verajs/motion/sequence` — scroll-scrubbed image sequences.
 *
 * A property module. It owns the `frame` property, the four `frame-*` settings
 * that configure it, the URL policy those settings need, and the canvas
 * drawing — none of which is in the runtime any more.
 *
 * ```js
 * import { createMotion, wireMotion } from '@verajs/motion';
 * import { sequence } from '@verajs/motion/sequence';
 *
 * wireMotion(sequence());
 * createMotion().init();
 * ```
 *
 * A factory rather than a plain descriptor, because the URL policy is an
 * instance decision the runtime used to hold: `sequence({ allowedOrigins: [...] })`
 * is how a CDN is permitted. Vera's own packages do the same where
 * configuration and installation are one act.
 *
 * Take `wireMotion` from `@verajs/motion` — this module exports a descriptor
 * and never registers itself.
 */
import { createSequence } from './modules/sequence.js';
import { pageProblem } from '@verajs/motion';
import { parseUrl } from './modules/url.js';
import { ATTRIBUTE_PREFIX } from './modules/namespace.js';
import type { Insert, PropertyDef, SettingDef, Wirable } from './modules/schema.js';

/**
 * What a GUI panel tells an author to import to make these attributes work.
 * One constant, so the specifier is one string in the bundle rather than one
 * per definition. See `PropertyDef.from`.
 */
const FROM = '@verajs/motion/sequence';

type Drawer = { draw(index: number): void; destroy(): void };

/**
 * One drawer per canvas, built on the first frame that asks for it.
 *
 * Lazily rather than at adoption, because the module has no adoption hook and
 * does not need one: nothing draws until the element is in play, and an
 * element that never comes into view never allocates a decoder.
 */
const drawers = new Map<Element, Drawer>();
/**
 * Canvases already refused, and why.
 *
 * A `WeakSet` before, which was enough to warn once rather than every frame —
 * but the reason was thrown away, so nothing could be told to anyone but a
 * console. `apply` now hands it to the runtime the first time, and
 * `MotionInstance.rejected` carries it from there.
 */
const refused = new Map<Element, string>();
/**
 * What each decision above was made from, so `prepare` can tell a stale one.
 *
 * Keyed for both outcomes, not just the drawers: a canvas refused for a
 * `frame-url` the policy would not permit has to be reconsidered when the url
 * is corrected, or fixing it in the GUI changes nothing.
 */
const decidedWith = new Map<Element, string>();

const read = (node: Element, name: string): string | null =>
  node.getAttribute(`${ATTRIBUTE_PREFIX}-${name}`);

/**
 * Every raw input `drawerFor` decides from, in one comparable string.
 *
 * Collected by prefix rather than from a list of the five names, which would
 * be a second copy of the settings table below and would drift from it the
 * first time a sixth setting was added — the new one would configure the
 * drawer and not invalidate it. Sorted because attribute order is not stable
 * across a remove-and-re-add.
 */
const settingsKey = (node: Element): string => {
  const parts: string[] = [];
  for (let i = 0; i < node.attributes.length; i++) {
    const attr = node.attributes[i]!;
    if (attr.name.startsWith(`${ATTRIBUTE_PREFIX}-frame-`)) parts.push(`${attr.name}=${attr.value}`);
  }
  return parts.sort().join('\u0000');
};

const drawerFor = (node: HTMLElement, allowedOrigins: readonly string[]): Drawer | null => {
  const existing = drawers.get(node);
  if (existing) return existing;
  if (refused.has(node)) return null;
  decidedWith.set(node, settingsKey(node));

  const fail = (message: string): null => {
    refused.set(node, message);
    console.warn(`@verajs/motion: ${message}`);
    return null;
  };

  if (!(node instanceof HTMLCanvasElement)) {
    return fail(`${ATTRIBUTE_PREFIX}-frame needs a <canvas> element.`);
  }

  /**
   * Validated again here, not just at parse time. `apply` is reachable for any
   * element the runtime hands over, and a decoder must never be built from a
   * url the policy refused — checking once, far away, is how that kind of hole
   * opens.
   */
  const url = parseUrl(read(node, 'frame-url') ?? '', window.location.origin, allowedOrigins);
  if (!url) return fail(`${ATTRIBUTE_PREFIX}-frame-url is missing or not permitted.`);

  const frames = Number(read(node, 'frame-count'));
  if (!Number.isFinite(frames) || frames < 1) {
    return fail(`${ATTRIBUTE_PREFIX}-frame-count must be a positive number.`);
  }

  const pad = Number(read(node, 'frame-pad'));
  const ext = read(node, 'frame-ext');
  /**
   * The same rule `parse.ts` applies to every boolean setting — a bare
   * attribute is true, as HTML's own booleans are. Read raw here because this
   * whole function re-reads rather than trusting the parsed record, for the
   * reason the url check above gives.
   */
  const tweenRaw = read(node, 'frame-tween');
  const tween = tweenRaw === '' || tweenRaw === 'true';
  const drawer = createSequence(node, {
    /**
     * A frame that does not load is the failure this module is most likely to
     * produce and used to be the only one it never mentioned. `frame-url` is a
     * prefix — nothing enforces the trailing slash the docs describe — so one
     * missing character builds `/seq0003.jpg`, every fetch 404s, and the canvas
     * stays blank with an empty `rejected`.
     */
    onFailure: (failed) => fail(`${ATTRIBUTE_PREFIX}-frame-url: nothing loaded, starting with ${failed}`),
    url,
    frames,
    ...(Number.isFinite(pad) && pad > 0 ? { pad } : {}),
    ...(ext ? { ext } : {}),
    ...(tween ? { tween } : {}),
  });
  if (!drawer) return fail('this canvas has no 2D context.');

  drawers.set(node, drawer);
  return drawer;
};

const forget = (node: Element): void => {
  drawers.get(node)?.destroy();
  drawers.delete(node);
  /**
   * Both of the other records too. `refused` was a `WeakSet` when it only had
   * to warn once; widening it to a `Map` to carry the reason gave it a strong
   * reference to every canvas it ever refused, and nothing removed one — so a
   * refused element outlived its own removal, its instance's `destroy()`, and
   * teardown.
   */
  refused.delete(node);
  decidedWith.delete(node);
};

export interface SequenceOptions {
  /**
   * Extra origins frames may be fetched from. Same-origin otherwise, and an
   * attribute can never widen it — the decision belongs to whoever wires the
   * module, not to the markup.
   */
  readonly allowedOrigins?: readonly string[];
}

/** Hand the result to `wireMotion`. */
export const sequence = (options: SequenceOptions = {}): readonly Wirable[] => {
  /**
   * Normalised, and complained about when it cannot be.
   *
   * `parseUrl` compares against `URL.origin`, which is scheme + host + port and
   * never a trailing slash — so `'https://cdn.test/'` matched nothing, and so
   * did `'cdn.test'` and `'https://cdn.test/path'`. Three of the four ways a
   * site owner would plausibly write it. Each failed **closed**, which is the
   * right direction and the reason this is not a security bug, and each failed
   * **silently**: every frame refused, and the reason reported against the
   * element rather than against the allowlist that caused it.
   *
   * `new URL(entry).origin` accepts the first three spellings and rejects a
   * bare host, which cannot be resolved without guessing a scheme — guessing
   * `https:` for something the owner may have meant as `http:` is not a
   * favour to do silently on a security boundary.
   */
  /**
   * A list, and a lone string is the way to get that wrong.
   *
   * `allowedOrigins: 'https://cdn.example'` — one origin, written as the thing
   * it is rather than as a list of one — threw `flatMap is not a function` out
   * of the factory, at module scope, before any instance existed. That is the
   * shape decision 31 named for `breakpoints` (`{ mobile: 640 }` threw `number
   * 640 is not iterable` out of `createMotion`), on the option that governs a
   * **security boundary**, where the page going down is not the worst reading
   * of a mistake.
   *
   * Refused rather than wrapped, which is what a bad *entry* already gets: two
   * ways to write one thing is how a list of one and a list of many stop
   * agreeing.
   */
  const declared = options.allowedOrigins;
  if (declared !== undefined && !Array.isArray(declared)) {
    pageProblem(
      `sequence allowedOrigins must be a list, not ${typeof declared}; ignoring it. ` +
      'Write one origin as a list of one, for example ["https://cdn.example"].'
    );
  }
  const allowedOrigins = (Array.isArray(declared) ? declared : []).flatMap((entry) => {
    try {
      return [new URL(entry).origin];
    } catch {
      pageProblem(
        `sequence allowedOrigins entry ${JSON.stringify(entry)} is not a url; ignoring it. ` +
        'Write the full origin, for example "https://cdn.example".'
      );
      return [];
    }
  });

  /**
   * Frame index within an image sequence. Drives a canvas rather than a style,
   * so it carries no `cssProperty` — the runtime routes it to this module's
   * `apply` instead.
   */
  const frame: PropertyDef = {
    attribute: 'frame',
    from: FROM,
    category: 'image',
    defaultUnit: '',
    units: [''],
    min: 0,
    initial: 0,
    /** No cssProperty: this paints a canvas rather than writing a style. */
    apply(node, value) {
      const drawer = drawerFor(node, allowedOrigins);
      /**
       * Drawn *and* asked whether anything has been refused since. A canvas
       * that never got a drawer was the only case this used to report, so a
       * sequence that built one and then failed every fetch — the likeliest
       * shape of a wrong `frame-url` — returned nothing at all.
       */
      if (drawer) drawer.draw(value);
      /**
       * Returned every frame the element stays refused, not only the first.
       *
       * There was a `refused.has(node)` check here to report it once — and it
       * made both guards untestable: `reject` already dedups, so removing
       * either one left the list at length one and every test still passed.
       * Two guards for one property is one guard nobody can prove. The
       * deduplication lives in `reject`, which is the only place that can see
       * every reporter.
       */
      return refused.get(node);
    },
  };

  const settings: readonly SettingDef[] = [
    {
      attribute: 'frame-url',
      from: FROM,
      type: 'string',
      /** The module's own origin policy — the runtime no longer carries one. */
      parse: (raw) => parseUrl(raw, window.location.origin, allowedOrigins),
    },
    /** How many frames the sequence has. The cap is what a sane sequence could be. */
    { attribute: 'frame-count', from: FROM, type: 'number', min: 1, max: 10000 },
    /** Zero-padding width of the frame number in the filename. */
    { attribute: 'frame-pad', from: FROM, type: 'number', min: 1, max: 12 },
    /**
     * Frame file extension. An allowlist rather than free text: this is
     * concatenated into a url, and it is the whole point of the setting that
     * only real image formats appear there (principle #8).
     */
    { attribute: 'frame-ext', from: FROM, type: 'string', allowed: ['jpg', 'jpeg', 'png', 'webp', 'avif'] },
    /**
     * Opt-in, not automatic. Whether stepping is visible depends on frames per
     * unit of scroll — a quantity the runtime knows only after measuring, and
     * one that changes with the viewport. Choosing for the author from it would
     * make the same markup behave differently on two screens, silently.
     */
    { attribute: 'frame-tween', from: FROM, type: 'boolean' },
  ];

  const lifecycle: readonly Insert[] = [
    /**
     * A drawer is built once and cached, which froze every `frame-*` setting at
     * the first frame drawn: changing `frame-url` or `frame-count` afterwards
     * did nothing at all. `release` is the only thing that dropped a drawer,
     * and it does not run on a re-parse — deliberately, since `drop()` is
     * bookkeeping — so nothing noticed the edit.
     *
     * The comparison is here rather than in `drawerFor` because `drawerFor`
     * runs per frame per element, and reading five attributes there is the DOM
     * work this library is built to avoid. `prepare` runs on `init()` and on
     * every `collect()`, which is exactly when an author's edit lands.
     */
    {
      on: 'prepare',
      fn: (root) => {
        for (const node of root.querySelectorAll(`[${ATTRIBUTE_PREFIX}-frame]`)) {
          const was = decidedWith.get(node);
          if (was !== undefined && was !== settingsKey(node)) forget(node);
        }
      },
    },
    { on: 'release', fn: forget },
    {
      on: 'teardown',
      fn: (owns) => {
        /**
         * `decidedWith`, not `drawers` — it is the complete roster: every
         * canvas that ever reached `drawerFor` is recorded there first,
         * refused ones included. **Defensive, and currently unreachable
         * beyond what `release` already covers** — only adopted nodes reach
         * `drawerFor`, and every core path that tears down releases each
         * element first, so a mutation back to `drawers` survives the suite.
         * The complete roster stays because it is what `teardown` *means*,
         * and the paths that make the difference invisible are core's, not
         * this module's to rely on.
         */
        for (const node of [...decidedWith.keys()]) if (owns(node)) forget(node);
      },
    },
  ];

  return [frame, ...settings, ...lifecycle];
};
