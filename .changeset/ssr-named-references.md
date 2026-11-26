---
'@verajs/ssr': patch
'@verajs/inserts': patch
'@verajs/core': patch
---

`@verajs/ssr/named-references`: every named character reference of the HTML Standard for the server DOM, as a module
to wire (`wire([namedReferences])`). The server's parser decodes six names itself (`&amp;`, `&lt;`, `&gt;`, `&quot;`,
`&apos;`, `&nbsp;`) and every numeric reference; wired, every other name reads back as the text a browser gives in
`textContent`, attributes, `.value` and a bound `<select>`'s options, by the tokenizer's rules: a legacy name without
its `;` decodes too (`&amp` in text is `&`), the longest name wins (`&notin` in text is `¬in`), and in an attribute
value a legacy name before `=` or a letter or digit stays as written (`&ampx=1`). A server that does not wire it never
loads the table and reads such a name back as written, as before, and now says so once per name written with its `;`
(`ssr-named-reference-unwired`). The served markup is unchanged. `'reference'` is the new insert point the module wires
on (types only).
