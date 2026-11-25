---
'@verajs/ssr': patch
---

The `base` option is checked the way it is used, by resolving `.` against it: a value that parses as a URL but holds no
directory (a Windows path such as `C:\dir\`, read as the scheme `c:`; a `mailto:` or `data:` URL) is refused as the
option, naming what to pass, where it passed the check and then failed with a bare `Invalid URL`.
