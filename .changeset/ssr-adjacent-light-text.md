---
'@verajs/ssr': patch
---

Two text light children placed side by side in one slot no longer merge in the browser

When a light component's text children ended up next to each other in one slot (`<b slot="h">H1</b>t1<b slot="h">H2</b>t2`
puts `t1` and `t2` together in the default slot), the browser parsed them as one text node while the light-tree
statement counted two, and hydration fell back to a client render. The server now writes an empty comment between
them. No client change is needed; the comment is never light content.
