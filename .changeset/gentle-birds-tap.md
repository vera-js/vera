---
'@verajs/ssr': patch
---

Describe the selector boundary as the list it is, rather than as one rule that is only half true.

`select.js` and the SSR README both explained every refusal the same way: "a pseudo-class needs user
state, layout or a document that a server does not have". True of `:hover`, `:checked` and `:root`.
False of `:first-child`, `:last-child`, `:nth-child()`, `:only-child`, `:empty`, `:first-of-type` and
`:nth-of-type()`, which are pure structure — this DOM has everything needed to answer them, and
refuses them anyway because the matcher does not implement them. A reader following the stated rule
would predict `:first-child` works.

Refusing stays the right behaviour: it is loud, and a wrong answer would not be. Implementing the
structural set is a feature, not a fix, and is not done here.

No behaviour change. `tests/ssr-selector-grammar.test.mjs` now holds the boundary as two lists — what
is refused because a server cannot answer it, and what is refused although a real DOM can — so a
selector crossing it is a decision rather than a surprise.
