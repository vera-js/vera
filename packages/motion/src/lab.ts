/**
 * Inertia lab. Not part of the library.
 *
 * The open question — does zero inertia read as skippy now the scroll loop is
 * frame-aligned? — is hard to judge on a trackpad, because macOS applies its
 * own momentum to the scroll *input*, which is easily mistaken for the
 * library's damping of the *output*.
 *
 * So this page drives the scroll itself at a constant rate, one step per
 * animation frame, and shows the same lateral motion at several damping
 * settings at once. Lateral movement makes lag legible in a way vertical
 * movement does not: the horizontal distance between the undamped marker and
 * a damped one *is* the inertia, visible without having to remember what the
 * previous frame looked like.
 */
import { createMotion } from './index.js';

/** Frame-multiples at 60Hz: 0, 1 frame, 2 frames, ~4, ~6. */
const INERTIAS = [0, 0.017, 0.033, 0.066, 0.1];

const tracks = document.getElementById('tracks') as HTMLElement;
const instances: ReturnType<typeof createMotion>[] = [];

INERTIAS.forEach((inertia, row) => {
  const track = document.createElement('div');
  track.className = 'track';
  /**
   * Paint-only separation. Laying the tracks out normally put each one ~82px
   * further down the document, which shifted its timeline — so the markers
   * spread out even at identical inertia, and the spread read as damping.
   */
  track.style.transform = `translateY(${row * 82}px)`;

  const label = document.createElement('div');
  label.className = 'label';
  label.innerHTML = `<b>${inertia}</b>${inertia === 0 ? 'exact' : 'seconds'}`;
  track.appendChild(label);

  const rail = document.createElement('div');
  rail.className = 'rail';

  const marker = document.createElement('div');
  marker.className = `marker${inertia === 0 ? ' zero' : ''}`;
  marker.textContent = String(inertia);
  marker.setAttribute('data-vm', '');
  /**
   * Viewport units for the *values*: a percentage translate resolves against
   * the element's own width, so `100%` moved these 46px rather than across the
   * rail. Two full turns as well, because rotation reads the damping on a
   * second axis: a marker behind laterally is also behind angularly.
   *
   * And viewport units for the **positions**, which is the fix for what this
   * page actually did. `0%`–`100%` is the element's *own* scroll window, and
   * a 46px marker near the top of the document has a very short one: the whole
   * animation finished by **scroll 200 of 4,400**, so it was pinned at 84vw for
   * 95% of the runway. The page says "start the drive, then stop it: watch how
   * long each takes to settle", and stopping it anywhere but the first few
   * hundred pixels showed five markers sitting still.
   *
   * The `.runway` is 520vh, so the positions span 500vh of it and the
   * animation now runs from 0 to about 3,600. Measured after the change: a jump
   * mid-runway spreads the markers 126px on the next frame and converges over
   * six, in inertia order.
   *
   * This page has been here before — an earlier audit caught the inertia
   * question being evaluated on a page where inertia never ran at all.
   * It ran this time; there was nowhere to watch it.
   */
  /**
   * Positions compensated for the row's own offset, in px.
   *
   * The paint-only separation above stopped being paint-only. The runtime
   * measures an element where it is *drawn* rather than only where it is laid
   * out, so a transform on an ancestor now moves its timeline with it — which
   * is right for a page, where a translated wrapper genuinely moves the thing
   * inside it, and fatal here: each row's timeline started 82px later than the
   * one above, the markers sat ~72px apart before anything had been scrolled,
   * and that constant gap read as damping. Which is the exact confound the
   * separation was chosen to avoid, arriving by the other door.
   *
   * There is no CSS arrangement that separates two elements visually and keeps
   * their timelines identical any more, because the timeline *is* the drawn
   * position. So the offset is cancelled where it can be: in the positions.
   *
   * In px rather than vh because the compensation is a px quantity, and read
   * once — a demo page that is resized mid-measurement is not the thing this
   * page is for.
   */
  const shift = row * 82;
  const span = 5 * window.innerHeight;
  marker.setAttribute(
    'data-vm-translate-x',
    `${-shift}px 2vw, ${span - shift}px 84vw`
  );
  marker.setAttribute(
    'data-vm-rotate',
    `${-shift}px 0deg, ${span - shift}px 720deg`
  );
  rail.appendChild(marker);

  track.appendChild(rail);
  tracks.appendChild(track);

  /** One instance per track, scoped to it, differing only in `inertia`. */
  const instance = createMotion({ inertia, respectReducedMotion: false, root: track });
  instance.init();
  instances.push(instance);
});

Object.assign(window, { instances });

/* ------------------------------------------------------- scroll driver -- */

const driveButton = document.getElementById('drive') as HTMLButtonElement;
const velocity = document.getElementById('vel') as HTMLInputElement;
const velocityLabel = document.getElementById('velv') as HTMLElement;
const direction = document.getElementById('dir') as HTMLSelectElement;

let running = false;
let frame: number | null = null;
let last = 0;

const step = (now: number): void => {
  if (!running) return;
  const dt = last ? (now - last) / 1000 : 0;
  last = now;

  const max = document.documentElement.scrollHeight - window.innerHeight;
  const next = window.scrollY + Number(velocity.value) * Number(direction.value) * dt;

  /** Turn around at either end rather than stalling against it. */
  if (next <= 0 || next >= max) direction.value = String(-Number(direction.value));

  window.scrollTo(0, Math.max(0, Math.min(max, next)));
  frame = requestAnimationFrame(step);
};

const setRunning = (next: boolean): void => {
  running = next;
  last = 0;
  driveButton.classList.toggle('on', running);
  driveButton.textContent = running ? '⏸ stop' : '▶ drive scroll';
  if (running) frame = requestAnimationFrame(step);
  else if (frame !== null) { cancelAnimationFrame(frame); frame = null; }
};

driveButton.addEventListener('click', () => setRunning(!running));
velocity.addEventListener('input', () => { velocityLabel.textContent = velocity.value; });
document.getElementById('top')!.addEventListener('click', () => {
  setRunning(false);
  window.scrollTo(0, 0);
});

/** Space toggles it, so you can watch rather than aim at a button. */
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); setRunning(!running); }
});
