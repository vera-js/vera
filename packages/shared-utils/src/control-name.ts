/**
 * **The accessible name a form control takes from its labels, computed (development only).** A reading of the accname
 * steps for an `<input>`: `aria-labelledby` (each id's text), then `aria-label`, then its `<label>`s (a wrapping one and
 * every `<label for>`, through the control's own `labels`), then `title`. A label's text skips `hidden` and
 * `aria-hidden="true"` subtrees and the control itself, and takes an element's `aria-label`, an image's `alt` and an
 * SVG's `<title>` in place of its children. It is a check that tells "no name" from a name, not the engine's
 * computation: a component's browser rows compare it with the engine's accessibility tree on their corpus.
 */

/** Whitespace runs as one space, trimmed: the text a name is compared as. */
export const flatText = (text: string): string => text.replace(/\s+/g, ' ').trim();

const skipped = (el: Element): boolean => el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true';

/** An SVG's own `<title>` child, read by walking its children: a selector is not needed for one level. */
const titleOf = (svg: Element): string => {
  for (const child of svg.children) if (child.localName === 'title') return child.textContent ?? '';
  return '';
};

/** The name content gives (accname's "name from content"), for one subtree, leaving `control` out. */
const fromContent = (node: Node, control: Element): string => {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 3) out += child.textContent ?? '';
    else if (child.nodeType === 1) {
      const el = child as Element;
      if (el === control || skipped(el)) continue;
      const label = el.getAttribute('aria-label');
      if (label !== null && flatText(label) !== '') out += ` ${label} `;
      else if (el.localName === 'img') out += ` ${el.getAttribute('alt') ?? ''} `;
      else if (el.localName === 'svg') out += ` ${titleOf(el)} `;
      else out += ` ${fromContent(el, control)} `;
    }
  }
  return out;
};

/** The control's accessible name from its labels, flattened; `''` when it has none. */
export const labelName = (control: HTMLInputElement): string => {
  const ids = control.getAttribute('aria-labelledby');
  if (ids !== null) {
    const root = control.getRootNode() as Document | ShadowRoot;
    let name = '';
    for (const id of ids.split(/\s+/)) {
      const target = id === '' ? null : root.getElementById(id);
      if (target !== null) name += ` ${fromContent(target, control)} `;
    }
    if (flatText(name) !== '') return flatText(name);
  }
  const label = flatText(control.getAttribute('aria-label') ?? '');
  if (label !== '') return label;
  let fromLabels = '';
  for (const each of control.labels ?? []) fromLabels += ` ${fromContent(each, control)} `;
  const labeled = flatText(fromLabels);
  return labeled !== '' ? labeled : flatText(control.getAttribute('title') ?? '');
};
