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

/**
 * A `<textarea>`'s children **are** its value, so comparing them as text counts it twice.
 *
 * `<textarea value="x">` is ignored by every parser: the only way markup can give a textarea a
 * value is to put it between the tags, which the server therefore does. The client sets the
 * property and leaves the children alone. The two agree on `value` — what is submitted and what the
 * user sees — and differ on `defaultValue`, which is the same difference React's SSR has and for
 * the same reason.
 */
const VALUE_IS_CONTENT = new Set(['textarea']);

/**
 * A nested component's shadow content, wherever this side keeps it.
 *
 * The server writes it as a `<template shadowrootmode>` child, whose content lives in `.content` and
 * **not** in `childNodes` — so walking children alone reported every nested component as empty. The
 * client keeps the same content in a real `shadowRoot`. Reading both into one marker is what lets a
 * component that renders another component be compared at all.
 */
const shadowOf = (element) => {
  if (element.shadowRoot) return element.shadowRoot;
  const template = [...element.children].find(
    (child) => child.localName === 'template' && child.hasAttribute('shadowrootmode')
  );
  return template?.content;
};

export const canonical = (node) => {
  let out = '';
  for (const child of node.childNodes) {
    if (child.nodeType === 8) continue;
    if (child.nodeType === 3) {
      out += child.data;
      continue;
    }
    /** The template *is* the shadow root on the server side; it is not also a light-DOM child. */
    if (child.localName === 'template' && child.hasAttribute('shadowrootmode')) continue;
    /**
     * `<style vera-styles>` is framework-injected, not content — the same category as the
     * renderer's marker comments, and skipped for the same reason.
     *
     * Markup cannot carry a constructed stylesheet, so `@verajs/ssr` serializes one as an element;
     * a browser adopts the sheet instead and `@verajs/styles` removes the element. Both pages are
     * styled by exactly one mechanism, and comparing the mechanism rather than the result would
     * make a correct pair look like a defect. That the count is exactly one is asserted separately,
     * where it is the subject rather than the noise.
     */
    if (child.localName === 'style' && child.hasAttribute('vera-styles')) continue;

    const mirrored = FORM_PROPERTIES[child.localName] ?? [];
    const attributes = [...child.attributes]
      .filter((attribute) => !mirrored.includes(attribute.name))
      .map((attribute) => `${attribute.name}=${JSON.stringify(attribute.value)}`)
      .sort();
    const properties = mirrored.map((name) => `${name}:${JSON.stringify(child[name])}`);
    const shadow = shadowOf(child);
    out +=
      `<${child.localName} ${[...attributes, ...properties].join(' ')}>` +
      (shadow ? `#shadow(${canonical(shadow)})` : '') +
      `${VALUE_IS_CONTENT.has(child.localName) ? '' : canonical(child)}</${child.localName}>`;
  }
  return out;
};
