---
'@verajs/ssr': patch
---

The server reads whitespace in markup as HTML does: tab, line feed, form feed, carriage return and space, and nothing
else. U+000B, U+00A0, U+FEFF, U+2028 and JavaScript's other non-HTML spaces are part of a name or an unquoted value to
a browser, and the server read them as spaces in a few places. A template holding one inside a tag could then be
served in a shape a browser reads differently: a value the server quoted could end early in the browser, and
`<script type` followed by U+000B was taken for a JSON block where a browser sees a script with no type, which runs.
These templates are now refused where a browser would read the value as part of a name (`name-expression`) or the
script as code (`ssr-script-hole`). An `<option>` matched by its text keeps a leading or trailing U+00A0, as a browser's
value does.

Parsing is faster too: the server now reads a tag's name, the space between its attributes and an end tag's name a
character at a time, where it ran a pattern on a fresh slice of the markup. A large page (50 KB) parses about
7% faster the first time and about 10% faster once warm, and a template compiles about 8% faster in steady state.
