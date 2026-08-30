---
'@verajs/core': patch
---

The warning for `render()` with no template no longer says something untrue.

It read: *"render() needs a template. If this component has no markup, call mount() instead — it
commits the setup and runs the hooks, which is what a bare render() used to do."* Both halves are
false of the function printing them. It does not need a template, and it still commits exactly as it
always did — the paragraph directly above the message in the source says so: *"It commits anyway.
Refusing would convert a naming preference into a component whose effects never run."*

Read at runtime by someone debugging, it says "your hooks are not running", which sends them looking
for a fault that is not there. The message now says what happens — the setup is committed and the
hooks run — and recommends `mount()` as the name for it.

Behaviour is unchanged. The test that covered this matched the literal old string, which is how the
message was able to drift into contradicting the assertion two lines above it; it now requires the
warning to name `mount()` and to make no claim that the hooks failed to run.
