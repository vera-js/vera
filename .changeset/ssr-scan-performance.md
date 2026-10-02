---
'@verajs/ssr': patch
---

Server rendering is faster: one tag scanner, read with indexed fast paths, in place of three character-by-character copies

Measured against the server renderer as it stood just before this tokenizer work, in fresh Node processes, ten
rounds each in a shuffled order, beside a byte-identical copy as an A/A control (its spread stayed at or under 1.1%;
every row won all ten rounds), on a quiet machine. "Cold" is the total of the first 100 calls in a new process, which
is what a server's first requests pay; "steady" is the time per call after a long warm-up.

| Workload | Cold | Steady |
| --- | --- | --- |
| A 50 KB trusted `.innerHTML` value | −63% | −82% |
| Compiling 200 distinct templates | −28% | −50% |
| A page of 100 nested components | −15% | −24% |
| A long article with one component | −13% | −22% |

Reproduce it from the repository with `npm run build && node bench/ssr-scan.mjs --compare 46060d3`; it waits for the
machine to be quiet before it times anything, and flags any row its A/A control says was disturbed.
