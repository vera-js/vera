# @vera-hooks/anchor

`anchor`: a headless Vera hook. Private until launch.

- **What it writes, while open:** the layer's inline `position`, `left`, `top`, `right`, `bottom`, `margin`, and the
  caps `max-height`, `max-width`, `min-width` and `min-height`. A page's own inline value for any of these is overridden
  while the layer is open, and `close()` and `release()` put back exactly what was there, priority included.
