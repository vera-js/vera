# @verajs/styles

## 0.1.0

### Minor Changes

- Initial release. `static styles` adoption for VeraJS components — constructed stylesheets into
  shadow roots, `@scope`-wrapped hoisting for light DOM — extracted from `@verajs/core`.
  
  ```js
  import { insert } from '@verajs/core';
  import { adoptStyles } from '@verajs/styles';
  insert('init', adoptStyles, 50);
  ```
  
  `minor` rather than `patch` because this package is at `0.0.0`: a patch would produce `0.0.1`,
  where minor produces `0.1.0` and sits with the rest of the family. The 0.x rule that minor signals
  a breaking change is about protecting existing consumers, and a package with no prior version has
  none.
