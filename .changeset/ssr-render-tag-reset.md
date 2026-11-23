---
'@verajs/ssr': patch
---

A render that follows a failed one no longer ships the next module's CSS under the wrong page. A component that threw
left its tag current, so a sheet the next render's module adopted on the document at import was filed under the
failed component, and came back in that component's `styles` on its next successful render. Every render now ends,
thrown or not, with no tag current.
