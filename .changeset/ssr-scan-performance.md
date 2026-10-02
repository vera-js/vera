---
'@verajs/ssr': patch
---

Server rendering is faster: one tag scanner, read with indexed fast paths, in place of three character-by-character copies

Measured against the server renderer as it stood just before this tokenizer work, in fresh Node processes, ten
rounds each in a shuffled order, beside a byte-identical copy as an A/A control (its spread stayed at or under 0.7%;
every row won all ten rounds). "Cold" is the total of the first 100 calls in a new process, which is what a server's
first requests pay; "steady" is the time per call after a long warm-up.

| Workload | Cold | Steady |
| --- | --- | --- |
| A 50 KB trusted `.innerHTML` value | −70% | −84% |
| Compiling 200 distinct templates | −30% | −50% |
| A page of 100 nested components | −16% | −25% |
| A long article with one component | −17% | −21% |
