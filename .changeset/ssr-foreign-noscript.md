---
'@verajs/ssr': patch
---

A component after a `<noscript>` written inside `<svg>` or `<math>` content is server-rendered where the browser
creates it. There a `<noscript>` is an SVG or MathML element like any, so a tag that ends foreign content
(`<svg><noscript><p><my-widget>`) ends it too, and the component after it is HTML; the server kept treating it as
noscript content and left it unrendered, so it rendered only on the client. A `<noscript>` at an HTML integration point
(`<foreignObject>`, `<mtext>` and the rest) is still HTML's, its content raw text.
