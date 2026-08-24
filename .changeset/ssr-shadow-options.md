---
'@verajs/ssr': patch
---

Shadow-root options reach the markup, because the client cannot put them back.

Only `mode` was serialized. Declarative shadow DOM also carries `shadowrootdelegatesfocus`,
`shadowrootclonable` and `shadowrootserializable` — and `attachShadow` **reuses a declarative root
while ignoring the options it is handed**, measured in Chromium. So a component asking for
`delegatesFocus: true` over server-rendered markup that omitted it kept `delegatesFocus === false`
for the life of the page, with no way to fix it client-side. Focus delegation is accessibility
behaviour: it does not break loudly, it just works worse.

`slotAssignment` has no declarative form at all, so a component that needs it cannot be faithfully
server-rendered. The README says so rather than pretending otherwise.
