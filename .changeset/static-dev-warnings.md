---
'@verajs/static': patch
---

Development now says `@verajs/core`'s warnings in core's words where static renders a value as core does but it is
probably a mistake: a boolean child that renders as the word (`boolean-child`), an attribute's whole value that is not
text (`attribute-value`), and a `javascript:` URL that static removes (`script-url`). Each is said once — a boolean per
template, hole and value, an attribute value per tag, name and kind, a removed URL per tag, name and value — and never
for a value static already names. Production is unchanged, byte for byte.
