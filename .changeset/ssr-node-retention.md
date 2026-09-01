---
'@verajs/ssr': patch
---

Retain child nodes, so a mutation after `appendChild` reaches the markup

`appendChild` serialised the child into the parent's `innerHTML` **string** and dropped the node, so
children were markup rather than nodes. Serialisation now happens when the markup is *read*, and the
node is kept:

| | before | now |
| --- | --- | --- |
| `host.appendChild(kid); kid.textContent = 'x'` | `<b></b>` — content silently lost | `<b>x</b>` |
| `kid.remove()` after append | silent no-op, still rendered | removed |
| `host.removeChild(kid)` | `TypeError` — the method did not exist | removes, and `NotFoundError` for a non-child |
| appending to a second parent | left it in both | moves it |
| `kid.parentNode` | `null` | the parent |

`children`, `childNodes`, `firstChild`/`lastChild`, `firstElementChild`/`lastElementChild`,
`childElementCount` and `hasChildNodes` now answer from the retained children instead of being
hardcoded empty. Appending a node into its own descendant throws `HierarchyRequestError`, as every
engine does — reachable only now that nodes are kept.

**Rendered output is byte-identical.** This changes *when* serialisation happens, not what it
produces; both committed fixtures match unchanged and the hydration suites are green. SSR throughput
is unchanged too — measured across three runs, within the harness's own spread.

**Markup assigned as a string is still not parsed**, so a container filled by `innerHTML` or by the
`children:` option has no node view. Asking for one now warns once instead of answering emptily in
silence. Parsing it is a later step.

The framework's own render path never calls `appendChild` — templates go through the serializer — so
this affects imperative DOM written in a component's `connectedCallback`.
