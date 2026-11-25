---
'@vera-components/field': patch
---

The field has a look: its parts stacked with a small gap, the label in the text color at weight 500, the hint and the
count muted, the shown error in the danger color, all from the shared `--vera-*` tokens. Zero specificity, keyed on the
field's own mark; `data-vera-look="none"` drops it. The control keeps its own edge: while an error shows the field marks
it `aria-invalid="true"`, which a `<vera-input>` draws as a red box.
