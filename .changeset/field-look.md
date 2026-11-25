---
'@vera-components/field': patch
---

The field has a look: its parts stacked with a small gap, the label in the text color at weight 500, the hint and the
count muted, the shown error in the danger color, all from the shared `--vera-*` tokens. While an error shows, the
field turns the shared border token to the danger color, so a `<vera-input>` inside draws its box in red. Zero
specificity, keyed on the field's own mark; `data-vera-look="none"` drops it.
