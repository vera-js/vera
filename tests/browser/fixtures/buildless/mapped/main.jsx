/** A mapped file imported by its PATH is the same module as its mapped name — one core, not two. */
const byName = await import('@verajs/core');
const byPath = await import('/packages/core/dist/vera.min.js');
const byUrl = await import(new URL('/packages/core/dist/vera.min.js', import.meta.url));
parent.postMessage({ kind: 'app', samePath: byName === byPath, sameUrl: byName === byUrl, view: <b>x</b>.strings.length }, '*');
