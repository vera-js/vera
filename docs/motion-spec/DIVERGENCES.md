# Divergence register

Recorded, principled differences. Anything not listed here is expected to behave identically.

## `when` — condition language is host-native
Same key, same gating role. **Vera takes a CSS selector** (`when: '.open'`) — its host is a
component framework where state reaches the DOM as classes. **Omni takes a state expression**
(`when: 'open'`, `when: '@cart > 0'`) — its whole grammar conditions on expressions. Neither side
accepts both languages in one attribute; a leading-character sniff was considered and rejected as
two condition systems in one key.

## `tick` — the registered-JS door
Vera ships it: the attribute NAMES a function registered from page code (`wireTicks({…})`) and
never contains one. Omni reserves the grammar but defers implementation until its WP-side
registration surface is designed — a sequencing posture, not a security one (a registry-named
function is the enqueued-script trust boundary, not content JS; an earlier stored-XSS framing of
this divergence was wrong and is corrected here).
