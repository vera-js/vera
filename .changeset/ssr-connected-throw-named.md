---
'@verajs/ssr': patch
---

A component that throws from its `connectedCallback` or its constructor is named. Only a throw from a render frame
was wrapped before; a callback's or constructor's own throw rejected `renderToString` with the bare error, so a page of
components said nothing about which one failed (a nested `<x-fail>` came back as just its message). It now rejects with
`ssr-render-threw` naming the component that threw, a nested one by its own tag, with the original error as `cause`
(the identical object), in `renderToString` and `renderToStringAsync` alike. This changes what such a failure looks
like: a coded refusal `@verajs/lite` throws while a component renders on the server (`unfinished-tag`,
`tier-hole-position`) arrives as that `cause`, no longer as the rejection itself. The README's Styles section now says
which per-request CSS warns (a sheet adopted on the document) and which is kept from the first render silently
(`@verajs/styles`, per class), and that the string form of `attributes` is read as the tag's attribute text.
