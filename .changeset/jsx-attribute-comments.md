---
'@verajs/jsx': patch
---

A comment among a JSX element's attributes is dropped, as TypeScript, Babel and esbuild drop it

`<button type="button" /* note */ class="x">` — or a `// why` line above one attribute of a long element — left that
element as raw JSX with no warning, and the bundler then failed on it with an unrelated parse error. Comments are now
skipped anywhere between attributes (beside `=`, before `>` and `/>` too), and an unterminated `/*` there is reported
with the file and position instead of passing the element through.
