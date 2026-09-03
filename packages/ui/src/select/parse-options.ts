/**
 * HTML-authored options — the buildless door (SELECT-V2 §1). A page writes the platform's own
 * vocabulary and the component reads it:
 *
 * ```html
 * <vera-select name="flavor">
 *   <optgroup label="Classics">
 *     <option value="vanilla" selected>Vanilla</option>
 *     <option value="chocolate" data-description="the safe pick">Chocolate</option>
 *   </optgroup>
 *   <vera-option value="pistachio" data-group="Modern">
 *     <svg slot="icon">…</svg> Pistachio
 *     <span slot="description">polarizing, correctly</span>
 *   </vera-option>
 * </vera-select>
 * ```
 *
 * `<option>` stays the low-ceremony spelling; `<vera-option>` exists because `<option>`'s
 * text-only content model is enforced by the HTML parser itself — element children are dropped
 * before any script runs, and the customizable-select relaxation that lifts this is not yet
 * cross-engine (Chrome 135 ✓, Safari 27 announced, Firefox flagged). A custom element has no
 * content restrictions in any engine; `slot` is reused as inert marker vocabulary. The day the
 * relaxation is everywhere, rich `<option>` children start working here with zero changes —
 * this parser already reads whatever the browser preserved.
 *
 * In shadow mode the children match no slot and are never rendered: invisible pure data, exactly
 * where data should sit — and what the server emits for SSR. Icon and description nodes are
 * CLONED into the option, so the light DOM stays the untouched source of truth (extracting them
 * would also make our own mutation observer see us as the mutator).
 */
import type { SelectOption } from '@verajs/hooks';

const optionFrom = (node: Element, group: string | null): SelectOption | null => {
  const tag = node.localName;
  if (tag === 'option') {
    const label = node.textContent?.trim() ?? '';
    const option: SelectOption = { label, value: node.getAttribute('value') ?? label };
    if (group !== null) option.group = group;
    if (node.hasAttribute('disabled')) option.disabled = true;
    const description = node.getAttribute('data-description');
    if (description) option.description = description;
    return option;
  }
  if (tag === 'vera-option') {
    let label = '';
    const option: SelectOption = { label: '', value: '' };
    for (const child of node.childNodes) {
      /** Comments are not content: Comment.textContent is its data, and an authored
       *  <!-- note --> polluted the label (measured). Text and elements only. */
      if (child.nodeType !== 1 && child.nodeType !== 3) continue;
      const slot = child instanceof Element ? child.getAttribute('slot') : null;
      if (slot === 'icon') option.iconBefore = child.cloneNode(true);
      else if (slot === 'icon-after') option.iconAfter = child.cloneNode(true);
      else if (slot === 'description') option.description = child.textContent?.trim() ?? '';
      else label += child.textContent ?? '';
    }
    option.label = label.trim();
    option.value = node.getAttribute('value') ?? option.label;
    const explicitGroup = node.getAttribute('data-group') ?? group;
    if (explicitGroup !== null) option.group = explicitGroup;
    if (node.hasAttribute('disabled')) option.disabled = true;
    return option;
  }
  return null;
};

/**
 * Read a host's light-DOM authored options. Returns null when the markup carries none — the
 * caller's signal that this select is property-driven, not HTML-driven.
 */
export const parseLightOptions = (
  host: Element
): { options: SelectOption[]; selected: SelectOption[]; consumed: Element[] } | null => {
  const options: SelectOption[] = [];
  const selected: SelectOption[] = [];
  /**
   * The top-level children this parse actually claimed. Light mode removes them after seeding —
   * authored options would otherwise sit as stray visible text beside the real UI — and it must
   * remove ONLY these. Clearing the host wholesale destroyed everything else the user put there,
   * a slotted trigger included, silently and only in light mode.
   */
  const consumed: Element[] = [];
  const take = (node: Element, group: string | null) => {
    const option = optionFrom(node, group);
    if (!option) return;
    options.push(option);
    if (node.hasAttribute('selected')) selected.push(option);
  };
  for (const child of host.children) {
    if (child.localName === 'optgroup') {
      const group = child.getAttribute('label');
      const before = options.length;
      for (const grandchild of child.children) take(grandchild, group);
      if (options.length > before) consumed.push(child);
    } else {
      const before = options.length;
      take(child, null);
      if (options.length > before) consumed.push(child);
    }
  }
  return options.length ? { options, selected, consumed } : null;
};
