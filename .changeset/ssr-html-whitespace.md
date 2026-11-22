---
'@verajs/ssr': patch
---

The server reads whitespace in markup as HTML does: tab, line feed, form feed, carriage return and space, and nothing
else. U+000B and U+00A0 are part of a name or an unquoted value to a browser, and the server read them as spaces in a
few places. A template holding one inside a tag could then be served in a shape a browser reads differently: a value
the server quoted could end early in the browser, and `<script type` followed by U+000B was taken for a JSON block where
a browser sees a script with no type, which runs. These templates are now refused where a browser would read the value
as part of a name (`name-expression`) or the script as code (`ssr-script-hole`). An `<option>` matched by its text keeps
a leading or trailing U+00A0, as a browser's value does.
