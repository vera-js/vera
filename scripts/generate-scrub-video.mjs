/**
 * Generates the scrub lab's ALL-INTRA test video — every frame a keyframe, so `currentTime`
 * seeking is one-frame work and the scrub ceiling is the display, not the decoder. This is the
 * encode the trademark scroll pages use; the lab's remote fallback has ordinary keyframe
 * spacing, which is exactly the choppiness being contrasted.
 *
 * Run: node scripts/generate-scrub-video.mjs   (needs Chrome via playwright; writes
 * examples/media/scrub-allintra.webm — gitignored, ~10-25MB, regenerate anywhere)
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('http://localhost:5178/examples/directives/flip-lab.html'); /* a secure-context page: WebCodecs needs one, about:blank does not qualify */

const bytes = await page.evaluate(async () => {
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/webm-muxer@5.0.3/+esm');
  const W = 1280, H = 720, FPS = 30, SECONDS = 8;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'V_VP9', width: W, height: H, frameRate: FPS },
  });
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { throw e; },
  });
  encoder.configure({ codec: 'vp09.00.10.08', width: W, height: H, bitrate: 6_000_000, framerate: FPS });

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const total = FPS * SECONDS;
  for (let i = 0; i < total; i++) {
    const t = i / total;
    /* a scene made to judge scrubbing: continuous motion, a sweeping bar, a big counter */
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, `hsl(${250 + t * 80} 60% ${12 + t * 8}%)`);
    g.addColorStop(1, `hsl(${190 + t * 120} 70% 22%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    for (let orb = 0; orb < 5; orb++) {
      const a = t * Math.PI * 2 * (orb + 1) * 0.5 + orb;
      ctx.beginPath();
      ctx.arc(W / 2 + Math.cos(a) * (140 + orb * 60), H / 2 + Math.sin(a) * (90 + orb * 40),
        26 - orb * 3, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(${orb * 60 + t * 360} 85% 65%)`;
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(255 255 255 / 0.92)';
    ctx.fillRect(0, H - 14, W * t, 14);
    ctx.font = '700 110px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`${(t * SECONDS).toFixed(2)}s`, W / 2, 140);
    ctx.font = '600 42px system-ui';
    ctx.fillText(`frame ${i}`, W / 2, 200);

    const frame = new VideoFrame(canvas, { timestamp: (i * 1e6) / FPS, duration: 1e6 / FPS });
    /** THE POINT: every frame a keyframe. */
    encoder.encode(frame, { keyFrame: true });
    frame.close();
    if (i % 30 === 0) await encoder.flush();
  }
  await encoder.flush();
  muxer.finalize();
  return Array.from(new Uint8Array(muxer.target.buffer));
});

mkdirSync('examples/media', { recursive: true });
writeFileSync('examples/media/scrub-allintra.webm', Buffer.from(bytes));
console.log(`wrote examples/media/scrub-allintra.webm (${(bytes.length / 1e6).toFixed(1)} MB, 8s @ 30fps, all-intra VP9)`);
await browser.close();
