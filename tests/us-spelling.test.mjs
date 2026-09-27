/**
 * **American English, everywhere** — `docs/CODE-PRINCIPLES.md` §1, enforced rather than trusted.
 *
 * Every tracked text file is read for British spellings from a CURATED list: a pattern as broad as
 * "-ise" would flag `promise`, `otherwise` and `exercise`, and a check that cries wolf gets deleted.
 * The list is the families that actually occur — `-our`, `-ise`/`-isation`, a doubled `l` before a
 * suffix, and a handful of single words — and the controls below prove it catches each family and
 * leaves US English alone, so a pattern edited into uselessness fails here rather than going quiet.
 *
 * Exempt, as the principle says: released CHANGELOG entries (they record what was published) and the
 * CSS color keyword `grey`, which is a different word from `gray` to a stylesheet.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ISE =
  'recognis|organis|normalis|serialis|initialis|minimis|maximis|optimis|realis|customis|prioritis|summaris|finalis|' +
  'utilis|synchronis|standardis|materialis|sanitis|specialis|memois|tokenis|capitalis|visualis|localis|penalis|' +
  'categoris|characteris|authoris|apologis|centralis|generalis|internalis|externalis|neutralis|stabilis|harmonis|' +
  'criticis|emphasis|hypothesis|synthesis|parameteris|modularis|randomis|rasteris|legitimis|nationalis|quantis|' +
  'percentis|canonicalis|internationalis|anonymis|personalis|rationalis|formalis|globalis|idealis|regularis|' +
  'socialis|popularis|polaris|metabolis|miniaturis|dramatis|equalis|homogenis|itemis|legalis|publicis|' +
  'systematis|vaporis|verbalis|mobilis|digitis|atomis|symbolis|theoris|trivialis|vectoris|virtualis|mechanis|' +
  'modernis|naturalis';
const OUR =
  'behavi|col|fav|hon|lab|neighb|rum|flav|harb|vap|arm|endeav|hum|od|sav|splend|parl|rig|val|vig|clam|tum|ferv|' +
  'cand|ard|demean|savi';
const DOUBLED =
  'cancel|label|model|travel|funnel|signal|level|fuel|tunnel|channel|marshal|counsel|dial|total|equal|rival|' +
  'quarrel|unravel|marvel';
const WORDS =
  'centre|centres|centred|defence|offence|licence|judgement|judgements|artefact|artefacts|analogue|enrol|enrols|' +
  'enrolment|whilst|amongst|learnt|spelt|programme|programmes|catalogue|catalogues|practise|practised|fulfil|fulfils|' +
  'skilful|wilful|sceptical|aluminium|manoeuvre|metre|metres|litre|litres|fibre|theatre|maths';
const BRITISH = new RegExp(
  `(?:${ISE})(?:e|es|ed|ing|er|ers|ation|ations|able)\\b|` +
    /* Not `-es` here: "analyses" is also the American plural of "analysis". */
    `(?:analys|paralys)(?:e|ed|ing)\\b|` +
    `(?:${OUR})our(?=(?:s|ed|ing|al|ally|able|ite|ites|ful|less|hood|ly)?\\b|[A-Z_])|` +
    `(?:${DOUBLED})l(?:ed|ing|er|ers)\\b|` +
    `\\b(?:${WORDS})\\b`,
  'gi'
);

/**
 * Also skipped: the fixtures omni contributes and regenerates (`docs/motion-spec/fixtures/*.json`) —
 * their text is omni's to spell, and a hand edit here is undone by the next regeneration.
 */
const SKIP = /CHANGELOG\.md$|package-lock\.json$|\.(png|jpg|ico|woff2|gz|svg)$|^tests\/us-spelling\.test\.mjs$|^docs\/motion-spec\/fixtures\/.*\.json$/;

test('the pattern catches every family and leaves US English alone', () => {
  const british = ['behaviour', 'Colours', 'neighbourhood', 'normalised', 'serialisation', 'unrecognised',
    'cancelled', 'labelling', 'centre', 'judgement', 'artefact', 'analyse', 'maths', 'NEUTRALISERS', 'outsideColour'];
  for (const word of british) assert.match(word, new RegExp(BRITISH.source, 'i'), `the pattern misses "${word}"`);
  const american = ['behavior', 'color', 'normalized', 'canceled', 'labeled', 'center', 'judgment', 'artifact',
    'promise', 'otherwise', 'exercise', 'advertise', 'hour', 'your', 'four', 'contour', 'cancellation', 'towards',
    'enrolled', 'analysis', 'analyses', 'paralyses', 'gray', 'grey'];
  for (const word of american) assert.doesNotMatch(word, new RegExp(BRITISH.source, 'i'), `the pattern flags "${word}"`);
});

test('no tracked file spells the British way', () => {
  const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter((f) => f && !SKIP.test(f));
  assert.ok(files.length > 500, `CONTROL: only ${files.length} files were read — the listing did not work`);
  const found = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    text.split('\n').forEach((line, index) => {
      for (const match of line.matchAll(BRITISH)) found.push(`${file}:${index + 1}: "${match[0]}"`);
    });
  }
  assert.deepEqual(found, [], `British spellings — docs/CODE-PRINCIPLES.md §1 asks for American English:\n  ${found.slice(0, 40).join('\n  ')}`);
});
