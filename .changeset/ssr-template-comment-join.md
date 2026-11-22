---
'@verajs/ssr': patch
---

Inside `<template>` content, a value bound in a comment now leaves one space where it was, as it already did
everywhere else. Without it the text on either side could join into a different token: `<template><!${v}--!>` was
served as `<!--!>`, which opens a comment that hid the rest of the page after the template.
