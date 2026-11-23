---
'@verajs/core': patch
---

A computed that reads itself, directly or through another, throws `computed-cycle` in development, read from plain
code or by an effect, where it recursed until the stack overflowed or re-ran about 1200 times a write. Production is
unchanged.
