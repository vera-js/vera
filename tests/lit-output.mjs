/**
 * **What lit-html actually renders**, measured from lit-html itself.
 *
 * `packages/renderer/README.md` prints a table of what a child position does with each kind of
 * value and says *"These match lit-html exactly, `null` and `undefined` included."* That is a claim
 * about someone else's implementation, and the only honest way to hold it is to run that
 * implementation — so this is lit's own output, recorded.
 *
 * **Data, not code.** Checked in for the same reason `tests/dom-surface.mjs` is: lit lives in
 * `bench/node_modules`, which is deliberately not a workspace member, so a root `npm ci` does not
 * install it and CI cannot import it. Recording the answers lets `tests/lit-parity.test.mjs` check
 * every build everywhere, and re-measure only where lit happens to be present.
 *
 * **Regenerating:** `cd bench && npm install`, then run the generator described in that suite.
 * Measured against lit-html 3.3.3.
 */
export const LIT_OUTPUT = {
  "child": {
    "a string": "<p>[text]</p>",
    "an empty string": "<p>[]</p>",
    "a number": "<p>[42]</p>",
    "zero": "<p>[0]</p>",
    "NaN": "<p>[NaN]</p>",
    "Infinity": "<p>[Infinity]</p>",
    "a negative number": "<p>[-1]</p>",
    "true": "<p>[true]</p>",
    "false": "<p>[false]</p>",
    "null": "<p>[]</p>",
    "undefined": "<p>[]</p>",
    "a bigint": "<p>[10]</p>",
    "an array of strings": "<p>[ab]</p>",
    "an empty array": "<p>[]</p>",
    "an array with holes": "<p>[ab]</p>",
    "a nested array": "<p>[abc]</p>",
    "an object": "<p>[[object Object]]</p>",
    "a Set": "<p>[ab]</p>",
    "a Map": "<p>[kv]</p>",
    "markup in a string": "<p>[&lt;b&gt;not markup&lt;/b&gt;]</p>",
    "an entity in a string": "<p>[a &amp;amp; b]</p>",
    "a quote in a string": "<p>[say \"hi\"]</p>",
    "unicode": "<p>[héllo 日本 🎉]</p>"
  },
  "attribute": {
    "a string": "<div class=\"text\">x</div>",
    "an empty string": "<div class=\"\">x</div>",
    "a number": "<div class=\"42\">x</div>",
    "zero": "<div class=\"0\">x</div>",
    "NaN": "<div class=\"NaN\">x</div>",
    "Infinity": "<div class=\"Infinity\">x</div>",
    "a negative number": "<div class=\"-1\">x</div>",
    "true": "<div class=\"true\">x</div>",
    "false": "<div class=\"false\">x</div>",
    "null": "<div class=\"\">x</div>",
    "undefined": "<div class=\"\">x</div>",
    "a bigint": "<div class=\"10\">x</div>",
    "an array of strings": "<div class=\"a,b\">x</div>",
    "an empty array": "<div class=\"\">x</div>",
    "an array with holes": "<div class=\"a,,,b\">x</div>",
    "a nested array": "<div class=\"a,b,c\">x</div>",
    "an object": "<div class=\"[object Object]\">x</div>",
    "a Set": "<div class=\"[object Set]\">x</div>",
    "a Map": "<div class=\"[object Map]\">x</div>",
    "markup in a string": "<div class=\"<b>not markup</b>\">x</div>",
    "an entity in a string": "<div class=\"a &amp;amp; b\">x</div>",
    "a quote in a string": "<div class=\"say &quot;hi&quot;\">x</div>",
    "unicode": "<div class=\"héllo 日本 🎉\">x</div>"
  },
  "multiPartAttribute": {
    "a string": "<div class=\"lead text tail\">x</div>",
    "an empty string": "<div class=\"lead  tail\">x</div>",
    "a number": "<div class=\"lead 42 tail\">x</div>",
    "zero": "<div class=\"lead 0 tail\">x</div>",
    "NaN": "<div class=\"lead NaN tail\">x</div>",
    "Infinity": "<div class=\"lead Infinity tail\">x</div>",
    "a negative number": "<div class=\"lead -1 tail\">x</div>",
    "true": "<div class=\"lead true tail\">x</div>",
    "false": "<div class=\"lead false tail\">x</div>",
    "null": "<div class=\"lead  tail\">x</div>",
    "undefined": "<div class=\"lead  tail\">x</div>",
    "a bigint": "<div class=\"lead 10 tail\">x</div>",
    "an array of strings": "<div class=\"lead a,b tail\">x</div>",
    "an empty array": "<div class=\"lead  tail\">x</div>",
    "an array with holes": "<div class=\"lead a,,,b tail\">x</div>",
    "a nested array": "<div class=\"lead a,b,c tail\">x</div>",
    "an object": "<div class=\"lead [object Object] tail\">x</div>",
    "a Set": "<div class=\"lead [object Set] tail\">x</div>",
    "a Map": "<div class=\"lead [object Map] tail\">x</div>",
    "markup in a string": "<div class=\"lead <b>not markup</b> tail\">x</div>",
    "an entity in a string": "<div class=\"lead a &amp;amp; b tail\">x</div>",
    "a quote in a string": "<div class=\"lead say &quot;hi&quot; tail\">x</div>",
    "unicode": "<div class=\"lead héllo 日本 🎉 tail\">x</div>"
  },
  "booleanAttribute": {
    "a string": "<input disabled=\"\">",
    "an empty string": "<input>",
    "a number": "<input disabled=\"\">",
    "zero": "<input>",
    "NaN": "<input>",
    "Infinity": "<input disabled=\"\">",
    "a negative number": "<input disabled=\"\">",
    "true": "<input disabled=\"\">",
    "false": "<input>",
    "null": "<input>",
    "undefined": "<input>",
    "a bigint": "<input disabled=\"\">",
    "an array of strings": "<input disabled=\"\">",
    "an empty array": "<input disabled=\"\">",
    "an array with holes": "<input disabled=\"\">",
    "a nested array": "<input disabled=\"\">",
    "an object": "<input disabled=\"\">",
    "a Set": "<input disabled=\"\">",
    "a Map": "<input disabled=\"\">",
    "markup in a string": "<input disabled=\"\">",
    "an entity in a string": "<input disabled=\"\">",
    "a quote in a string": "<input disabled=\"\">",
    "unicode": "<input disabled=\"\">"
  }
};
