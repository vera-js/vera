---
'@verajs/ssr': patch
---

The server reads an open tag's attributes as the parser does, quotes included, everywhere it edits markup it already
wrote. Removing a name before writing it again (a spread key, a bound attribute after a static one), an option's
`value` and its `selected` were three patterns over the written markup that did not see quotes or the end of a name, so
they matched text the parser reads as part of a value:

- a spread's `id` (or any key) after a value holding ` id=…` cut that value open, and the rest of the spread's value was
  served as attributes, a live event handler included;
- a spread's `src` cut `srcset=` to `set=`, and a bound `href` removed the word `href` from a static title;
- `<select .value=…>` read an option's value from `data-value` or from a title holding `value=…`, and selected the
  wrong option, and clearing an author's `selected` removed the word from a title;
- every earlier copy of a name is now removed before it is written again, not only the first: the parser keeps the
  first of a duplicated name and the client's write replaces it, so any copy left behind would be the one served.

On a seeded corpus of 30,000 templates, the served markup changed only where a name was written twice in the statics.
