# Video scrubbing — design notes

**Status: measured, and deliberately shipped as a recipe rather than a feature** (2026-08-26).
The analysis below stands; the conclusion changed, for two reasons.

**1. `onProgress` exists now.** This document was written when the library had no outbound hook, so
building `data-vera-motion-video` was the only way to offer scrubbing at all. It is now a few lines of
consumer code — the recipe is in the README, and it is strategy 3a below verbatim.

**2. Measured, coalescing helps and is still not enough.** Scrubbing a 4s/30fps clip 120 frames
across in Chromium, on an ordinary web encode (`spikes/video-scrub.mjs`):

Three runs, median with the range beside it. A decode under a clock does not repeat exactly, and
these were quoted to one decimal from a single run: re-checked, the naive count sat outside the
range it had been reported at.

| | distinct frames shown | mean lag |
|---|---|---|
| naive `currentTime` per frame | 42 of 120 (40–43) | ~31 frames |
| coalesced + `requestVideoFrameCallback` | 71 of 120 (70–72) | ~18 frames |

So the coalescing in 3a is worth roughly 70% more frames and half the lag — real, and worth
documenting. But **even the coalesced version trails by ~0.6s of video**, which confirms §1's
headline: the encoding decides this, not the code. Building it in would let people skip the part
that actually matters, and would spend budget to make a bad default slightly less bad.

`data-vera-motion-frame` already ships, is frame-exact, needs no re-encoding, and its module is 2,062
bytes gzipped, wired by the page rather than loaded on demand — the dynamic import it used to have is
gone (decision 28) — 372 KB for the demo's 48 frames, 3 KB each. An all-intra video of the same content is
not obviously smaller.

**Revisit if:** WebCodecs demuxing becomes cheap enough to reconsider 3b, or a consumer reports the
recipe is not enough in practice.

Scrubbing a video by scroll position: the same effect as image-sequence scrubbing
(`sequence.ts`, shipped), but driven from a single video file instead of hundreds of stills.

---

## 1. Why this is not just "image sequences but smaller"

The appeal is obvious — one 2 MB video instead of 300 × 40 KB stills, and the codec does the
compression work. The difficulty is equally specific:

**`video.currentTime = x` is not a frame-accurate seek, and it is not fast.** The element seeks to
the nearest *keyframe* and decodes forward from there. With a typical web encode — a keyframe every
2–10 seconds — a seek can mean decoding hundreds of frames, and the browser is free to land on a
different frame than you asked for. Neither the timing nor the result is guaranteed.

Image sequences have neither problem: frame *n* is a file, and fetching it is a cache hit or a
request. That is why `sequence.ts` is straightforward and this is not.

**The single most important variable is how the video is encoded, not how the code is written.**
Any implementation here is downstream of that, and it needs saying in the docs loudly enough that
people actually do it.

---

## 2. The encoding requirement

For scrub-ability, the file must be re-encoded with a **very short keyframe interval** — ideally
all-intra (every frame a keyframe), or a GOP of 1–5 frames.

```sh
# every frame a keyframe — largest file, best scrubbing
ffmpeg -i in.mp4 -c:v libx264 -g 1 -crf 24 -pix_fmt yuv420p -movflags +faststart -an out.mp4

# GOP of 5 — a reasonable compromise
ffmpeg -i in.mp4 -c:v libx264 -g 5 -keyint_min 5 -sc_threshold 0 -crf 23 \
       -pix_fmt yuv420p -movflags +faststart -an out.mp4
```

Notes that matter:

- `-movflags +faststart` puts the index at the front, so seeking works before the whole file arrives.
- `-an` drops audio. A scrubbed video has no use for it, and it doubles the seek work.
- All-intra roughly **3–6×** the file size of a normal encode. A 2 MB video becomes 8 MB — at which
  point compare it honestly against the image sequence it was meant to replace, because a windowed
  image sequence may transfer *less* for a given scroll.
- Keep the resolution to what is actually displayed. Decode cost scales with pixels, not file size.

**A video that has not been re-encoded this way will scrub badly no matter what the code does.**

---

## 3. Three strategies

### 3a. `currentTime` + `requestVideoFrameCallback` — recommended first implementation

Set `currentTime`, then use `requestVideoFrameCallback` to know when a frame has actually been
presented rather than guessing.

```js
let pending = false;
const seek = (time) => {
  if (pending) { queued = time; return; }   // coalesce: seeks do not queue usefully
  pending = true;
  video.currentTime = time;
  video.requestVideoFrameCallback((_, meta) => {
    pending = false;
    // meta.mediaTime is the frame actually shown — use it, not currentTime
    if (queued != null) { const t = queued; queued = null; seek(t); }
  });
};
```

- **Coalescing is essential.** Scroll produces a new target every frame; issuing a seek per scroll
  event queues work the decoder cannot keep up with. Hold at most one in flight and one queued.
- **`meta.mediaTime` is the frame that was actually presented.** `currentTime` after a seek is not
  reliable for identifying the frame.
- rVFC fires at `min(video fps, display refresh)`, which is the right cadence — no point running
  faster than the video has frames.

**Support:** Chrome and Safari. **Firefox does not implement it.** Same shape of problem as
scroll-driven animations (spec §3.2): degrade rather than block. Without rVFC, fall back to setting
`currentTime` on the existing rAF loop and accept coarser results, or fall back to an image sequence
if one is supplied.

**Cost estimate:** ~120–180 lines, ~600–900 bytes gzipped, as a wired module like `@verajs/motion/sequence` — its own entry point with its own size budget, costing a page that does not import it nothing.

### 3b. WebCodecs — frame-accurate, materially more work

`VideoDecoder` gives direct access to decoded frames, so frame *n* means frame *n*. It is the only
route to genuine frame accuracy.

The cost is that you take on demuxing: WebCodecs decodes, it does not parse containers. An MP4
demuxer is a dependency or several hundred lines, which is difficult to reconcile with a 9 KB budget
and a zero-dependency rule. You also manage `VideoFrame` lifetimes by hand — every frame must be
`.close()`d or memory climbs until the tab dies.

**Worth it only if 3a proves insufficient in practice.** Do not start here.

### 3c. Hybrid — video when it works, sequence when it does not

`data-vera-motion-video-src` plus `data-vera-motion-frame-url` as a fallback, picking based on
`'requestVideoFrameCallback' in HTMLVideoElement.prototype`.

Honest assessment: this doubles the authoring burden (produce both assets) and the code paths, to
serve Firefox. Probably not worth it unless Firefox usage is material for the site in question. Note
it as available, do not build it by default.

---

## 4. Proposed attribute API

Consistent with the existing grammar — the value is a percentage of the video's duration, so it
behaves like any other numeric property:

```html
<video data-vera-motion
       data-vera-motion-video="0% 0, 100% 100"
       muted playsinline preload="auto"
       src="./scrub.mp4"></video>
```

| attribute | type | notes |
|---|---|---|
| `data-vera-motion-video` | keyframe list, values 0–100 | percentage of duration; a normal property |
| `data-vera-motion-video-fallback` | url | optional image-sequence base, for 3c |

The element must be a `<video>` — reject anything else with a warning, as `frame` does for
`<canvas>`. `muted` and `playsinline` are required by mobile autoplay policy and should be set by
the runtime if absent rather than relying on the author.

Schema entry, mirroring `frame`:

```ts
{ attribute: 'video', category: 'video', defaultUnit: '%', units: ['%'], min: 0, max: 100, initial: 0 }
```

`category: 'video'` has no `cssProperty`, so `planFor` routes it to a `video` slot exactly as
`sequence` is routed today, and the schema invariant test needs `'video'` adding to its
non-style-applied list.

---

## 5. Pitfalls, in the order they will bite

1. **Unre-encoded source.** Everything else is secondary. Document the ffmpeg command prominently.
2. **Not coalescing seeks.** Looks like it works on a fast machine and falls apart on a real one.
3. **iOS Safari.** Requires `playsinline` and `muted`; without both it goes fullscreen or refuses to
   load. Historically it also would not seek until a user gesture — verify current behaviour on a
   real device, not a simulator.
4. **`preload="auto"` is not a guarantee.** Browsers ignore it on metered connections. Seeking before
   enough is buffered fails silently; watch `readyState >= HAVE_CURRENT_DATA`.
5. **Firefox.** No rVFC. Decide degradation up front rather than discovering it late.
6. **Memory on long videos.** The element buffers what it decodes. A long all-intra file at high
   resolution will consume a great deal.
7. **`reduced motion`.** Show a poster frame, not a video stuck mid-scrub.

---

## 6. Recommendation

Build **3a**. Ship it on demand like `sequence.ts`, so the bytes reach only pages that use it.
Document the ffmpeg requirement in the same breath as the attribute, because the feature is
unusable without it.

Do not build 3b unless 3a measurably fails, and do not build 3c unless Firefox matters to a specific
site.

**And measure it against an image sequence before committing.** For short animations with a windowed
loader, image sequences may well transfer less and scrub more reliably. Video wins on long sequences
and on pages where the request count matters; it is not automatically the better option.

---

## Sources

- [requestVideoFrameCallback — MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback)
- [Perform efficient per-video-frame operations — web.dev](https://web.dev/articles/requestvideoframecallback-rvfc)
- [Scrubbing videos using JavaScript — Muffin Man](https://muffinman.io/blog/scrubbing-videos-using-javascript/)
- [Playing with video scrubbing animations on the web — Abhishek Ghosh](https://www.ghosh.dev/posts/playing-with-video-scrubbing-animations-on-the-web/)
- [WebCodecs video scroll synchronization tutorial](https://lionkeng.medium.com/a-tutorial-webcodecs-video-scroll-synchronization-8b251e1a1708)
