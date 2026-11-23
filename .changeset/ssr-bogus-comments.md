---
'@verajs/ssr': patch
---

The server's DOM reads `<!x>` and `<?y>` in assigned markup as comments, as every parser does; they were read as text,
so `textContent` answered the markup itself. A NUL in a comment's data reads as U+FFFD, as in a browser. The served
bytes are unchanged.
