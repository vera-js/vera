# @verajs/jsx

JSX/TSX for VeraJS with zero dependencies: a hand-rolled parser compiles JSX into the renderer's
tagged templates (`onClick`→`@click`, `className`→`class`, `value`→`.value`, `key`→`keyed()`,
components become function calls). One JSX call site = one template call site — template identity
and every renderer fast path hold. Zero runtime cost via the Vite plugin (`veraJsx()`); in-browser
transform for playgrounds via `@verajs/jsx/standalone` (`<script type="text/vera-jsx">`).
