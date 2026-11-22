---
'@verajs/renderer': patch
---

In development, the template check finds the end of a `<style>`, `<script>` or text-only element in the template as
written, so text holding `İ` before the end tag no longer moves the end it reports. Production is unchanged.
