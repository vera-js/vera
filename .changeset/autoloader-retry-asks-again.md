---
'@verajs/autoloader': patch
---

`retry(element)` can now succeed. It imported the URL that had failed, and an engine keeps a failed module import by its
URL (Chromium 159, and Firefox and WebKit before 159 and 27), so a retry answered from that record without asking the
server and reported the same failure again. A retry of an import that rejected now imports the module with
`vera-retry=<n>` added to its URL. A module of its own that failed to load stays failed in such an engine until the page
reloads, and a module that loaded but did not define its tag, or defined it and then threw, is not run again. On a page
whose import map pins anything with `integrity`, every retry imports as it is (a pin is keyed by the URL the map
resolves to, so a new query would load a file unchecked, remapped or not); there, in an engine that keeps a failed
import (Chromium), a module that failed stays failed until the page reloads. A retry while that
tag is still loading does nothing, so a retry button pressed twice imports once.
