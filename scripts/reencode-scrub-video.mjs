/**
 * Re-encodes the scrub lab's ORIGINAL video all-intra — same content, every frame a keyframe —
 * so the encode's effect can be judged on identical footage. No ffmpeg: the file is downloaded
 * once (cross-origin pixels are unreadable, local serving makes it same-origin), played in
 * Chrome, captured frame-by-frame via requestVideoFrameCallback, and re-encoded with WebCodecs
 * (H.264, keyFrame on every frame) into an in-memory-fastStart MP4.
 *
 * Run: node scripts/reencode-scrub-video.mjs
 * Writes: examples/media/original-allintra.mp4 (gitignored; regenerate anywhere)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const SOURCE = 'https://greenlightdash.pro/wp-content/uploads/2026/05/videoupscale-web.mp4';
mkdirSync('examples/media', { recursive: true });

if (!existsSync('examples/media/original.mp4')) {
  const response = await fetch(SOURCE);
  writeFileSync('examples/media/original.mp4', Buffer.from(await response.arrayBuffer()));
  console.log('downloaded the original');
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:5178/examples/directives/flip-lab.html'); /* any secure-context page */

const bytes = await page.evaluate(async () => {
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.1/+esm');
  const video = document.createElement('video');
  video.src = '/examples/media/original.mp4'; /* same-origin: pixels readable */
  video.muted = true;
  video.style.cssText = 'position:fixed;width:4px;height:4px;opacity:0.01';
  document.body.appendChild(video); /* rVFC never fires on a detached video */
  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(new Error('load failed')), { once: true });
  });
  const scale = Math.min(1, 1280 / video.videoWidth);
  const W = Math.round(video.videoWidth * scale / 2) * 2;
  const H = Math.round(video.videoHeight * scale / 2) * 2;
  const FPS = 30;

  /** PHASE 1 — capture: play once, keep a bitmap per presented frame (capped). */
  const bitmaps = [];
  const done = new Promise((resolve) => video.addEventListener('ended', resolve, { once: true }));
  const capture = async () => {
    if (bitmaps.length < 400) bitmaps.push(await createImageBitmap(video, { resizeWidth: W, resizeHeight: H }));
    video.requestVideoFrameCallback(capture);
  };
  video.requestVideoFrameCallback(capture);
  await video.play();
  await done;
  if (bitmaps.length === 0) throw new Error('no frames captured — the measure-nothing control');

  /** PHASE 2 — the encode loop PROVEN by generate-scrub-video.mjs, byte for byte the same
   *  shape: same configure, canvas → VideoFrame, keyFrame every frame, flush every 30. */
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: FPS },
    fastStart: 'in-memory',
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({ codec: 'avc1.4d0028', width: W, height: H, bitrate: 8_000_000, framerate: FPS });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  for (let i = 0; i < bitmaps.length; i++) {
    ctx.drawImage(bitmaps[i], 0, 0, W, H);
    const frame = new VideoFrame(canvas, { timestamp: (i * 1e6) / FPS, duration: 1e6 / FPS });
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    bitmaps[i].close();
    if (i % 30 === 0) await encoder.flush();
  }
  await encoder.flush();
  muxer.finalize();
  return { data: Array.from(new Uint8Array(muxer.target.buffer)), frames: bitmaps.length, W, H, dur: video.duration, chosen: 'avc1.4d0028' };
});

writeFileSync('examples/media/original-allintra.mp4', Buffer.from(bytes.data));
console.log(`wrote examples/media/original-allintra.mp4 — ${(bytes.data.length / 1e6).toFixed(1)} MB, ` +
  `${bytes.frames} frames captured of ${bytes.dur.toFixed(1)}s at ${bytes.W}x${bytes.H}`);
await browser.close();
