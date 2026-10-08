/**
 * **Light-DOM slots, distributed on the server** — while `@verajs/renderer/slots` is wired (its `'slot'` insert is the
 * marker), once a light host's render is final. The browser module distributes in the browser; this writes the end state
 * it leaves, plus the one thing the DOM alone cannot say, and hydration (`@verajs/renderer/hydration`) adopts it in place.
 *
 * Each filled slot is written exactly as the client leaves it: its region's two markers around the assigned content, the
 * `<slot>` stepped out; an unfilled slot stays, showing its fallback. The markers keep text from merging across a
 * range's edge; INSIDE a range (or the carrier) two text light children written side by side would merge in the
 * browser's parser — `<b slot="h">H1</b>t1<b slot="h">H2</b>t2` puts `t1t2` in the default range, one node where the
 * statement counts two — so an empty comment goes between them (`separate`). Hydration needs no rule for it: a range's
 * comments are never light content.
 *
 * What the DOM alone cannot say is written once, on the host: `data-vm-light`, `FORMAT:runs` — for each light child in
 * light-tree order, the index of the range it went into (ranges numbered in document order, the unassigned carrier
 * last), run-length encoded as `index*count`. Distribution loses which nodes are light children at all (a component's own
 * elements can carry `slot` too) and their order ACROSS slots; this is both. `FORMAT` bumps only when the format changes,
 * and hydration renders such a host fresh, with the fix, when it meets another number.
 *
 * **Deliberate twins** of the browser side's names — the markers and the carrier are slots', the attribute and the
 * number hydration's. ssr does not import the renderer at runtime, so they are copied, not shared;
 * `tests/slots-ssr-client-parity.test.mjs` fails if the two sides ever disagree.
 */
import { CommentShim, createElement, slotName } from './nodes.js';
import type { ElementShim } from './nodes.js';

const FORMAT = '1';
const RANGE_START = '[';
const RANGE_END = ']';
const UNASSIGNED = 'vm-unassigned';
const LIGHT_ATTR = 'data-vm-light';

type Child = ElementShim['childNodes'][number];

/** Inserts `node` before `ref`, after an empty comment if the node before it there is text too — or they would merge. */
const separate = (parent: ElementShim, node: Child, ref: Child | null) => {
  if (node.nodeType === 3 && (ref === null ? parent.lastChild : ref.previousSibling)?.nodeType === 3) parent.insertBefore(new CommentShim(''), ref);
  parent.insertBefore(node, ref);
};

/** Distributes `source` — the host's light children, held out of its render — into the host's rendered slots. */
export const distributeLight = (host: ElementShim, source: Child[]): void => {
  const buckets = new Map<string, Child[]>();
  const light: Child[] = [];
  for (const node of source) {
    const name = slotName(node);
    if (name === null) continue;
    light.push(node);
    let bucket = buckets.get(name);
    if (bucket === undefined) buckets.set(name, (bucket = []));
    bucket.push(node);
    node.parentNode?.removeChild(node);
  }
  const filled = new Set<string>();
  /** How many ranges received content, numbered in document order — see `data-vm-light`. */
  let ranges = 0;
  const rangeOf = new Map<Child, number>();
  /** Collected first: the live list mutates as slots are unwrapped. */
  for (const slot of [...host.querySelectorAll('slot')]) {
    const parent = slot.parentNode;
    if (parent === null) continue; // already unwrapped as another slot's assigned content
    const name = slot.getAttribute('name') ?? '';
    const assigned = !filled.has(name) ? buckets.get(name) : undefined;
    if (assigned !== undefined && assigned.length > 0) {
      filled.add(name);
      /** The client's own region, exactly: its two markers around the content, the slot stepped out. */
      parent.insertBefore(new CommentShim(RANGE_START), slot);
      for (const node of assigned) {
        separate(parent as ElementShim, node, slot);
        rangeOf.set(node, ranges);
      }
      ranges++;
      parent.insertBefore(new CommentShim(RANGE_END), slot);
      parent.removeChild(slot);
    }
    /** A slot with nothing assigned STAYS, showing its fallback — as the client keeps it (Brian, 2026-10-02). */
  }
  /**
   * **Whatever no slot claimed is PRESERVED, in the client's own container** — `<vm-unassigned hidden>`, the host's first
   * child, in light-tree order, exactly where the client keeps it: present and connected, unrendered, as native leaves an
   * unassigned light child. It is the last range of the statement.
   */
  let carrier: ElementShim | null = null;
  for (const node of light)
    if (!rangeOf.has(node)) {
      if (carrier === null) {
        carrier = createElement(UNASSIGNED);
        carrier.setAttribute('hidden', '');
      }
      separate(carrier, node, null);
      rangeOf.set(node, ranges);
    }
  if (carrier !== null) host.insertBefore(carrier, host.firstChild);
  /** The light order, run-length encoded — written on every light host, empty after the number when it has none. */
  const runs: string[] = [];
  for (let k = 0; k < light.length; ) {
    const index = rangeOf.get(light[k])!;
    let n = 1;
    while (k + n < light.length && rangeOf.get(light[k + n]) === index) n++;
    runs.push(n === 1 ? `${index}` : `${index}*${n}`);
    k += n;
  }
  host.setAttribute(LIGHT_ATTR, `${FORMAT}:${runs.join(',')}`);
};
