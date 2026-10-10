---
'@verajs/ssr': patch
---

The server DOM refuses what the platform refuses at the Node interface, and a text node is a `Node`

A behavior change, made to match every browser (a fix under 0.x, so a patch). Server code that relied on the server
being more permissive now throws there, as it would have on the client:

- **A Node-typed argument that is not a node is a `TypeError`**: `appendChild({})`, `insertBefore({}, null)` and
  `replaceChild({}, child)` were accepted; `contains({})`, `isSameNode({})`, `isEqualNode({})` and
  `compareDocumentPosition({})` answered instead of refusing; `removeChild(null)`, `removeChild({})` and a non-node
  reference to `insertBefore`/`replaceChild` threw a `NotFoundError` instead of a `TypeError`. `contains()` and
  `insertBefore(node)` with an argument missing are refused, as WebIDL counts arguments first.
- **`Illegal constructor`** for `new HTMLElement()`, `new HTMLElement('div')`, `new Node()`, `new CharacterData()`, a
  class never passed to `customElements.define`, and an undefined subclass of a defined one. A defined class,
  `new Text()`, `new Comment()`, `new Image()` and `new Audio()` construct as before.
- **A text node is a `Node`** — `Node` was the container class, so text and comments answered `instanceof Node` with
  `false` — and `CharacterData`, `Text` and `Comment` are exposed. `Node`'s constants are on every node
  (`text.TEXT_NODE` was `undefined`).
- **`append`, `prepend`, `before`, `after`, `replaceWith` and `replaceChildren` convert a non-node to text**, as the
  `(Node or DOMString)` union does: `append({})` inserts `[object Object]`, where it inserted an empty element, and
  `after(7)`, `replaceWith({})` and `replaceChildren({}, null)` threw.
- **`String(node)` names its interface** for text (`[object Text]`), comments, fragments and shadow roots, where every
  node said `[object EventTarget]`.

Measured against jsdom and confirmed on Chromium, Firefox and WebKit.
