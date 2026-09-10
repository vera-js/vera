/**
 * SSR emission — the write-path's stage 7, closing the first-frame defect.
 *
 * Motion had no server story at all: a `fade-up` element arrived visible, snapped hidden when JS
 * activated, then animated. Under generated CSS the animation IS the initial frame — the seek is
 * `animation-delay: calc(var(--vm-p, 0) * -1s)`, the variable's initial value is 0 by `@property`
 * (and by the calc's own fallback where `@property` is unsupported or stripped), so a
 * server-rendered page paints frame 0 correctly with no JavaScript. No second mechanism to keep
 * in step: this pass runs the SAME parser and the SAME generator the client runs, and the content
 * hash is FNV-1a over the same text, so the client re-derives every name byte for byte and its
 * own delivery simply takes over.
 *
 * **The no-JS guard is a neutraliser, never a gate** (§7, measured reasoning): rules are emitted
 * unguarded and `@media (scripting: none) { [data-vm-motion] { animation: none } }` lands LAST in each
 * emitted sheet, so a no-JS visitor sees the natural state — while an engine predating the
 * `scripting` feature (unknown feature → query false → neutraliser inert) still animates when JS
 * runs. Gating on `(scripting: enabled)` would have killed all motion on every older browser WITH
 * JavaScript: a far larger population than the guard protects.
 *
 * Runs under any DOM — the vera SSR shim, or jsdom — because the parser it shares with the client
 * validates selectors through the document in scope. Node with no DOM installed is not enough.
 */
import { parseMotion, MOTION_ATTR } from './parse.js';

import { generateSimple } from './generate.js';

import { STAGGER_PROPERTY } from './registry.js';

import { registerVocabulary, setProblemReporter } from './schema.js';
import type { Generated, RenderMotionOptions, RenderMotionReport } from './types.js';



/** The seams a connector needs to register vocabulary, with everything engine-shaped inert. */
const ssrSeams = (problems: { code: string; args: readonly string[] }[]): object => ({
  _$seams$: true,
  setParse: (): void => {},
  setEvalExpr: (): void => {},
  directive: (): void => {},
  action: (): undefined => undefined,
  reject: (_el: unknown, _directive: string, code: string, args?: readonly unknown[]): void => {
    problems.push({ code, args: (args ?? []).map(String) });
  },
});

/** One root's collected sheet: insertion-ordered, deduped by the client's own registry keys. */
type Sheet = Map<string, string>;

/** DOUBLED selectors — a single-attribute tail loses on specificity to every element rule
 *  (0-1-0 vs 0-2-0); doubled it ties and wins on order. Reduced motion first, scripting last —
 *  order between them is indifferent (both neutralise), the pair pins after every rule. */
const NEUTRALISERS =
  '@media (prefers-reduced-motion: reduce) { [data-vm-motion][data-vm-motion] { animation: none; } }\n' +
  '@media (scripting: none) { [data-vm-motion][data-vm-motion] { animation: none; } }';

/**
 * Collects one element's rules into its root's sheet, in the client's acquisition order — groups,
 * segment keyframes, the element rule, then the media switches. The switches AFTER the element
 * rule is the cascade invariant from stage 5b: they tie it on specificity, so sheet source order
 * decides, and a switch emitted first loses everywhere, silently.
 */
const collect = (sheet: Sheet, generated: Generated): void => {
  if (generated.mode === 'transition') {
    /** Base, active, no-JS — the order IS the mechanism (specificity ties, later wins). A
     *  no-JS visitor gets the ACTIVE values statically: the base state is the hidden one. */
    sheet.set(`${generated.hash}#b`, generated.elementRule);
    sheet.set(`${generated.hash}#t`, generated.armedRule);
    sheet.set(`${generated.hash}#on`, generated.activeRule);
    sheet.set(`${generated.hash}#nj`, generated.noJsRule);
    sheet.set(`${generated.hash}#rm`, generated.reducedRule);
    return;
  }
  for (const group of generated.groups) sheet.set(group.hash, group.rule);
  for (const segment of generated.segments) {
    for (const rule of segment.rules) sheet.set(rule.hash, rule.rule);
  }
  sheet.set(`${generated.hash}#el`, generated.elementRule);
  for (const [i, segment] of generated.segments.entries()) {
    sheet.set(`${generated.hash}#m${i}`, segment.media);
  }
  if (generated.nativeRule) sheet.set(`${generated.hash}#n`, generated.nativeRule);
};

/**
 * The one style element this pass owns in a root, marked exactly as the client's fallback path
 * marks its own (`data-vm-sheet`) — deliberately the SAME marker: on an engine without
 * constructed sheets the client finds this element and takes it over, and on one with them the
 * adopted sheet simply outranks it on cascade order.
 */
const styleIn = (root: Document | ShadowRoot, doc: Document): HTMLStyleElement => {
  const parent = root.nodeType === 9 ? (root as Document).head : (root as ShadowRoot);
  for (const child of parent.children) {
    if ((child as HTMLElement).dataset?.['vmSheet'] === 'motion') return child as HTMLStyleElement;
  }
  const style = doc.createElement('style');
  style.dataset['vmSheet'] = 'motion';
  parent.appendChild(style);
  return style;
};

/**
 * Emits generated motion CSS for a server-rendered document, in place.
 *
 * Marks every in-scope `data-vd-motion` element with its content-hash identity (`data-vm-motion`) and
 * writes one `<style data-vm-sheet>` per tree that needs one — the document's into `<head>`,
 * and one INSIDE each open shadow root holding motion elements, because keyframes resolve per
 * tree scope (measured; the same fact that shapes the client registry). `@property` declarations
 * go in the document sheet only — registration is document-global in every engine — and each
 * sheet ends with the `(scripting: none)` neutraliser, last because its position IS its function.
 *
 * Closed shadow roots are invisible here exactly as the platform hides them; their elements keep
 * the client-only behaviour.
 */
export const renderMotion = (doc: Document, options: RenderMotionOptions = {}): RenderMotionReport => {
  const problems: { code: string; args: readonly string[] }[] = [];
  setProblemReporter((code, args) => problems.push({ code, args: (args ?? []).map(String) }));

  const seams = ssrSeams(problems);
  for (const entry of options.wire ?? []) {
    if (typeof entry === 'function') (entry as (s: object) => void)(seams);
    else registerVocabulary(entry as never);
  }

  const sheets = new Map<Document | ShadowRoot, Sheet>();
  const varNames = new Set<string>();
  let rendered = 0;
  let skipped = 0;

  const walk = (root: Document | ShadowRoot): void => {
    for (const el of root.querySelectorAll(`[${MOTION_ATTR}]`)) {
      const parsed = parseMotion(el, el.getAttribute(MOTION_ATTR) ?? '', {});
      const generated = parsed ? generateSimple(parsed) : null;
      if (!generated || (!generated.groups.length && generated.mode !== 'transition')) {
        skipped++;
        continue;
      }
      /**
       * A `%` stagger is knowable server-side (index × step, no geometry), so frame 0 paints
       * STAGGERED — the offset var goes out inline. Geometry staggers (px/vh) need the scroll
       * window; those elements paint unstaggered at frame 0 and the client's first measure
       * corrects, which beats not painting at all.
       */
      /**
       * Tier N is NEVER pre-opted from the server, deliberately: a view timeline on a page
       * without scrollable overflow is INACTIVE and paints NOTHING — not even the base frame —
       * and rendered height is unknowable here. The #n rule still ships in the sheet; the
       * client opts eligible elements in after confirming the scroller scrolls, and the
       * upgrade is seamless because both tiers compute the same number.
       */
      if (parsed!.stagger && parsed!.stagger.positionUnit === '%') {

        (el as HTMLElement).style.setProperty(STAGGER_PROPERTY, String(parsed!.stagger.position / 100));
      }
      let sheet = sheets.get(root);
      if (!sheet) sheets.set(root, (sheet = new Map()));
      collect(sheet, generated);
      for (const v of generated.vars) varNames.add(v.name);
      el.setAttribute('data-vm-motion', generated.hash);
      /** Pre-ARMED on the server: first paint already has base, so no change ever fires and
       *  the client's arming frame is unnecessary — reversals work from the first script. */
      if (generated.mode === 'transition') el.setAttribute('data-vm-armed', '');
      rendered++;
    }
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  walk(doc);

  let rules = 0;
  for (const [root, sheet] of sheets) {
    const parts = [...sheet.values()];
    /**
     * `@property` in the DOCUMENT sheet only — its registration reaches shadow trees in all
     * three engines (measured, `keyframes-tree-scope.test.js`), so a shadow sheet repeating it
     * would be duplication, and shadow-only pages still get it because the document sheet is
     * created whenever any tree rendered.
     */
    const declarations = root === (doc as Document | ShadowRoot)
      ? [...varNames].map((name) =>
        `@property ${name} { syntax: '<number>'; inherits: false; initial-value: 0; }`)
      : [];
    rules += parts.length;
    styleIn(root, doc).textContent =
      [...declarations, ...parts, NEUTRALISERS].join('\n');
  }
  /** Shadow trees rendered but the document tree did not: the `@property` block still needs a
   *  home in `<head>`, or timed modes degrade to midpoint-flips everywhere. */
  if (varNames.size && !sheets.has(doc)) {
    styleIn(doc, doc).textContent =
      [...[...varNames].map((name) =>
        `@property ${name} { syntax: '<number>'; inherits: false; initial-value: 0; }`),
      NEUTRALISERS].join('\n');
  }

  return { rendered, skipped, rules, problems };
};
