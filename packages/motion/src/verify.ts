/**
 * The cascade-override instrument — DEVELOPMENT ONLY, and the generated path's missing half of
 * the refusal story.
 *
 * The write path's whole design is "one shared sheet, 0-2-0 doubled selectors, cascade order as
 * the tiebreak" — which means an author rule CAN outrank it (`!important`, a 0-3-0 selector, a
 * later layer), and when one does the element simply sits still: no throw, no refusal, nothing
 * in the console, because the CSS cascade is doing exactly what CSS does. That silence is the
 * worst failure shape this package has, so delivery verifies itself: one frame after an element
 * is marked, its computed values are compared to what the generated rules SAY they should be,
 * and a mismatch is reported by name.
 *
 * Five shapes were weighed (recorded in the portal design log): static author-CSS scanning
 * (needs a CSS parser this repo will not ship, false-positive-rich), a document-wide specificity
 * walk (`document.styleSheets` throws on CORS sheets), an emitted canary property (detects rule
 * LOSS but not per-property overrides, and costs production bytes for a dev instrument), a
 * pull-only inspector API (Studio's half, later — this module is what it will read), and
 * computed-value verification — which catches both loss and override, costs nothing in
 * production (`__DEV__` folds every call site away), and needs no new emission.
 *
 * **The environment mute is load-bearing, not defensive.** jsdom and its cousins do not compute
 * styles from adopted/constructed sheets, so "computed animation-name is empty" is ambiguous
 * there: environment limitation or real override. The first suspected failure per document runs
 * a SENTINEL — a detached-then-attached div styled through a fresh constructed sheet, the same
 * mechanism the registry uses. If the sentinel cannot compute either, the whole document is
 * muted and nothing is ever reported: jsdom is the regression net, never the oracle.
 */
import { prefersReducedMotion } from './supports.js';
import { pageProblem } from './schema.js';
import type { Generated } from './types.js';

/** Documents where computed styles provably do not reach adopted sheets — never report there. */
const muted = new WeakSet<Document>();
/** Documents whose sentinel already PASSED — skip re-proving the environment. */
const proven = new WeakSet<Document>();

/**
 * Can this document compute a value from a constructed sheet at all? One div, one fresh sheet,
 * one read — memoized both ways.
 */
const environmentComputes = (doc: Document): boolean => {
  if (proven.has(doc)) return true;
  if (muted.has(doc)) return false;
  const view = doc.defaultView;
  if (!view || typeof view.CSSStyleSheet !== 'function') {
    muted.add(doc);
    return false;
  }
  let answer = false;
  const probe = doc.createElement('div');
  probe.className = 'vm-verify-probe';
  try {
    const sheet = new view.CSSStyleSheet();
    sheet.replaceSync('.vm-verify-probe { animation-name: vm-verify-canary; }');
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
    doc.body?.appendChild(probe);
    answer = view.getComputedStyle(probe).animationName === 'vm-verify-canary';
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter((s) => s !== sheet);
  } catch {
    answer = false;
  }
  probe.remove();
  (answer ? proven : muted).add(doc);
  return answer;
};

/** Every animation-name list the generated rules could legitimately produce: the base group
 *  names, plus each band segment's switched list. Order-insensitive on purpose — the check is
 *  "are OUR names applied", not "in which arrangement". */
const expectedNames = (generated: Generated): Set<string> => {
  const names = new Set<string>();
  for (const group of generated.groups) names.add(group.name);
  for (const segment of generated.segments) {
    for (const { hash } of segment.rules) names.add(`vm-${hash}`);
  }
  return names;
};

/**
 * Verifies one delivered element, one frame after its mark. Skips — deliberately, each for a
 * reason — reduced-motion contexts (the emitted neutralisers legitimately zero everything),
 * function-only elements (nothing was generated to verify), and disconnected nodes (no cascade
 * to ask). Reports once per element per delivery.
 */
export const verifyDelivered = (node: HTMLElement, generated: Generated): void => {
  const doc = node.ownerDocument;
  const view = doc?.defaultView;
  if (!view || prefersReducedMotion(node)) return;
  if (!generated.groups.length && generated.mode !== 'transition') return;
  view.requestAnimationFrame(() => {
    if (!node.isConnected || !environmentComputes(doc)) return;
    const computed = view.getComputedStyle(node);
    if (generated.mode === 'transition') {
      /** Armed elements must carry the longhands; an author transition shorthand resets them. */
      if (!node.hasAttribute('data-vm-armed')) return;
      const properties = computed.transitionProperty;
      if (properties === '' || properties === 'all' || properties === 'none') {
        pageProblem('motion-css-overridden', ['transition-property', properties || '(empty)']);
      }
      return;
    }
    const applied = computed.animationName.split(',').map((name) => name.trim());
    const expected = expectedNames(generated);
    if (!applied.some((name) => expected.has(name))) {
      pageProblem('motion-css-overridden', ['animation-name', computed.animationName || '(empty)']);
    }
  });
};
