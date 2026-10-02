/**
 * **The text a reader SEES, as these suites mean it:** the text of every text node that is not inside a `[hidden]`
 * subtree — comments excluded. Light slots keep unassigned content CONNECTED, in the host's `<vm-unassigned hidden>`
 * container, as native keeps an unassigned light child in the light tree, so `textContent` (the TREE's text) includes
 * it exactly as a shadow host's does; what is rendered does not. jsdom has no layout, so no `innerText`: the browser
 * suites check this definition against the real one.
 */
export const shown = (node) =>
  node.nodeType === 3 ? node.data
  : node.nodeType === 1 && node.hasAttribute('hidden') ? ''
  : node.nodeType === 1 || node.nodeType === 11 ? [...node.childNodes].map(shown).join('')
  : '';
