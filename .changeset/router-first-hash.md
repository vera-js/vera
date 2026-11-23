---
'@verajs/router': patch
---

A URL's fragment starts at its first `#`, as the URL parser reads it: a landing URL whose fragment holds a `#`
(`/p#!/x#y`) matched no route, and `/search?q=a#top#x` read its query as `q=a#top`.
