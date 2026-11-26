---
'@verajs/ssr': patch
---

A JSON data block in `.innerHTML` markup (`<script type="application/json">`, any type ending in `json`) is served with its own `type` instead of the inert one, so page code finds it by its type. It never runs, in a page or in an assignment; every other script in the markup is served inert as before.
