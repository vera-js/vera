/**
 * A canonical string for a DOM subtree, shared by every server/client parity suite.
 *
 * Comparison is on normalized DOM rather than markup text, because two legitimate differences are
 * not defects: the author's quote characters travel in the statics (`class='v'` server, `class="v"`
 * client), and attribute order is not meaningful. Comments are dropped — the renderer's markers are
 * an implementation detail. Form state is compared as a **property** on both sides: the server
 * mirrors `.value`/`.checked` to an attribute precisely so hydration can read it back, so the
 * attribute is the implementation and the property is the truth.
 *
 * Lives here rather than in one suite because the next parity harness needs exactly the same rules,
 * and two copies of "what counts as the same DOM" would drift into disagreeing about it.
 */
const FORM_PROPERTIES = { input: ['value', 'checked'], option: ['value', 'selected'], textarea: ['value'] };

export const canonical = (node) => {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      out += child.data;
      continue;
    }
    const mirrored = FORM_PROPERTIES[child.localName] ?? [];
    const attributes = [...child.attributes]
      .filter((attribute) => !mirrored.includes(attribute.name))
      .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort();
    const properties = mirrored.map((name) => `${name}:${JSON.stringify(child[name])}`);
    out += `<${child.localName} ${[...attributes, ...properties].join(' ')}>${canonical(child)}</${child.localName}>`;
  }
  return out;
};
