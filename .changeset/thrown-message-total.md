---
'@verajs/autoloader': patch
---

A `resolve` option that throws a value which is not an Error is reported, instead of crashing the report

The autoloader's and directive loader's `resolve` option, and a motion tick or vocabulary function, are the author's
code, and JavaScript lets code throw anything. The error report read `.message` or called `String()` on what was
thrown, so `null`, an object with no prototype, or an object whose own methods throw crashed the report itself,
replacing the real failure with an unrelated error from inside the framework. The value is now described by a
formatter that never throws (an unreadable value reads as "[unprintable value thrown]"), and the autoloader's
refused-URL errors keep the `href` they carry.
