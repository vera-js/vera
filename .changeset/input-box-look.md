---
'@vera-components/input': patch
---

The input looks like an input: the element is the box (a hairline border, rounded corners, the surface and text
colors, 36px on a 16px page) with your input borderless inside it and the clear, reveal and loading parts beside it,
inside the border. Focus draws one ring around the box, an invalid input turns the border to the danger color, and a
disabled one dims it. Everything reads the shared `--vera-*` tokens, and `scale` now sizes the box, which the input
follows. `data-vera-look="none"` still drops all of it.
