---
'@verajs/router': patch
---

A navigation from a page the user never scrolled makes one history call instead of two. Each entry the router pushes now starts with its scroll stamp at the top, so leaving it unscrolled needs no second `replaceState`; Back still restores the same position in every case. An entry the router pushes carries `0` as its history state until the router stamps a scroll position on it. Engines cap these calls (WebKit at 100 in 10 seconds), so this also doubles how many such navigations fit under the cap.
