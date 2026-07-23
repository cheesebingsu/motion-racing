// hand-tracking.js — ES module
// Webcam-based hand tracking that turns two-hand "steering wheel" tilt into a
// steering value for the racing game.
//
// NOTE: getUserMedia (webcam) only works on a secure context — i.e. https://
// or http://localhost. Opening index.html via file:// will NOT grant camera
// access. Serve the folder locally (e.g. `python -m http.server`) and open it
// at http://localhost:PORT/ .

import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

// Tuning constants for the steering math.
const FULL_LOCK_DEG = 32;   // ~30-35 deg of wheel tilt == full lock (steering ±1)
const LERP = 0.3;           // smoothing factor toward the target steering each frame
const GRACE_MS = 250;       // hold the last steering this long when a hand briefly drops

// Hand skeleton topology (21 landmarks) for drawing the overlay.
const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],        // thumb
  [0, 5], [5, 6], [6, 7], [7, 8],        // index
  [5, 9], [9, 10], [10, 11], [11, 12],   // middle
  [9, 13], [13, 14], [14, 15], [15, 16], // ring
  [13, 17], [17, 18], [18, 19], [19, 20],// pinky
  [0, 17],                               // palm base
];

/**
 * Create and start a live hand tracker.
 *
 * @param {HTMLVideoElement} videoEl - the <video> element the camera stream attaches to.
 * @param {HTMLCanvasElement} [overlayCanvas] - optional canvas laid over the webcam
 *        preview; the detected hand landmarks are drawn onto it as points + lines.
 * @returns {Promise<{steering:number, detected:boolean, tiltDeg:number, stop:Function}>}
 *          A live-updating controller object whose fields are refreshed every frame.
 */
export async function createHandTracker(videoEl, overlayCanvas) {
  // --- 1. Camera ---
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
  } catch (err) {
    throw new Error(
      "카메라를 사용할 수 없습니다. 카메라 권한을 허용하고 localhost 또는 https 환경에서 실행하세요. (" +
        (err && err.message ? err.message : err) +
        ")"
    );
  }

  videoEl.srcObject = stream;

  // Wait until the video actually has frame data / dimensions.
  await new Promise((resolve) => {
    if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      resolve();
      return;
    }
    videoEl.onloadeddata = () => resolve();
  });

  try {
    await videoEl.play();
  } catch (_) {
    // Autoplay may already be handling playback; ignore.
  }

  // --- Overlay canvas for the hand skeleton (points + lines) ---
  // Matched to the video's intrinsic size; CSS scales it to the preview box and
  // mirrors it the same way as the <video>, so landmarks line up on the mirror.
  let octx = null;
  if (overlayCanvas) {
    overlayCanvas.width = videoEl.videoWidth || 640;
    overlayCanvas.height = videoEl.videoHeight || 480;
    octx = overlayCanvas.getContext('2d');
  }

  function drawHands(hands) {
    if (!octx) return;
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    octx.clearRect(0, 0, w, h);
    const dot = Math.max(3, w * 0.009);
    const line = Math.max(2, w * 0.006);
    for (const lm of hands) {
      // connections
      octx.strokeStyle = 'rgba(35, 224, 255, 0.9)';
      octx.lineWidth = line;
      octx.lineCap = 'round';
      for (const [a, b] of HAND_CONNECTIONS) {
        octx.beginPath();
        octx.moveTo(lm[a].x * w, lm[a].y * h);
        octx.lineTo(lm[b].x * w, lm[b].y * h);
        octx.stroke();
      }
      // landmark points
      for (let i = 0; i < lm.length; i++) {
        octx.beginPath();
        octx.arc(lm[i].x * w, lm[i].y * h, i === 0 ? dot * 1.6 : dot, 0, Math.PI * 2);
        octx.fillStyle = i === 0 ? '#ffd23c' : '#ff3ea5'; // wrist = yellow
        octx.fill();
      }
    }
  }

  // --- 2. MediaPipe HandLandmarker init ---
  let handLandmarker;
  try {
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numHands: 2,
      // Lowered from the 0.5 defaults so a rotated / gripped hand (as when
      // turning the wheel) keeps being tracked instead of dropping out.
      minHandDetectionConfidence: 0.3,
      minHandPresenceConfidence: 0.3,
      minTrackingConfidence: 0.3
    });
  } catch (err) {
    // Clean up the camera we already opened before bailing.
    for (const track of stream.getTracks()) track.stop();
    throw new Error(
      "손 인식 모델을 불러오지 못했습니다. 인터넷 연결을 확인하세요. (" +
        (err && err.message ? err.message : err) +
        ")"
    );
  }

  // --- 3. The live controller object ---
  const tracker = {
    steering: 0, // [-1, 1], 0 = straight, + = right
    detected: false, // true when >= 2 hands seen this frame
    tiltDeg: 0, // wheel tilt in degrees, RELATIVE to the calibrated neutral (for #wheel UI)
    stop,
    calibrate, // capture the current hand pose as "straight" (absorbs camera rotation)
    setSensitivity // adjust steering sensitivity (multiplier; >1 = more sensitive)
  };

  // Steering sensitivity multiplier. 1 = default; higher turns more per hand tilt.
  let sensitivity = 1;
  function setSensitivity(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return;
    sensitivity = Math.max(0.3, Math.min(3, n));
  }

  let rafId = 0;
  let lastVideoTime = -1;
  let running = true;

  // Neutral-angle calibration: whatever raw tilt the hands are at when calibrate()
  // is called becomes 0° (straight). This makes steering robust to the camera being
  // rotated (e.g. a phone held in landscape) and to the user's natural resting angle.
  let neutralDeg = 0;
  let lastRawTilt = 0;
  let lastTwoHandsAt = 0; // timestamp (performance.now) of the last 2-hand frame

  function calibrate() {
    neutralDeg = lastRawTilt;
  }

  function loop() {
    if (!running) return;
    rafId = requestAnimationFrame(loop);

    // Only run detection when the video advanced to a new frame.
    if (videoEl.currentTime === lastVideoTime) return;
    lastVideoTime = videoEl.currentTime;

    let result;
    try {
      result = handLandmarker.detectForVideo(videoEl, performance.now());
    } catch (_) {
      // Never let a detection hiccup kill the loop.
      return;
    }

    const hands = (result && result.landmarks) || [];

    // Draw the live skeleton overlay for whatever hands are visible.
    drawHands(hands);

    if (hands.length >= 2) {
      // Wrist landmark is index 0 of each hand.
      const w0 = hands[0][0];
      const w1 = hands[1][0];

      // Order the two wrists left->right in *image* coordinates so the sign of
      // the angle is stable regardless of which hand MediaPipe reported first.
      let left = w0;
      let right = w1;
      if (w0.x > w1.x) {
        left = w1;
        right = w0;
      }

      // Vector from the left wrist to the right wrist.
      const dx = right.x - left.x;
      // Image y grows downward. Screen is mirrored (preview uses scaleX(-1)),
      // but the x-ordering above already runs left->right in *image* space,
      // which is the mirror of what the user sees. Negating dy makes the tilt
      // match the user's perception: raising your right (physical) hand — the
      // hand that appears on the LEFT of the mirrored preview — turns positive.
      const dy = right.y - left.y;

      // Raw tilt of the imaginary wheel, in degrees.
      // atan2(dy, dx): when the right-image wrist is lower than the left one
      // (dy > 0) the user has rolled the wheel clockwise -> turning right.
      const angleRad = Math.atan2(dy, dx);
      let tiltDeg = (angleRad * 180) / Math.PI;

      // Clamp stray large angles (hands crossed / vertical) to a sane range.
      if (tiltDeg > 90) tiltDeg -= 180;
      if (tiltDeg < -90) tiltDeg += 180;

      // Remember the raw angle so calibrate() can snapshot it as the neutral pose.
      lastRawTilt = tiltDeg;

      // Steer relative to the calibrated neutral, wrapped back into [-90, 90].
      let rel = tiltDeg - neutralDeg;
      while (rel > 90) rel -= 180;
      while (rel < -90) rel += 180;

      tracker.tiltDeg = rel;
      tracker.detected = true;

      // Map tilt to steering. Sign is negated so the car turns the SAME way the
      // user rolls the wheel from their own point of view (fixes reversed steering).
      // The sensitivity multiplier scales how much steering each degree produces.
      let target = (-rel / FULL_LOCK_DEG) * sensitivity;
      if (target > 1) target = 1;
      if (target < -1) target = -1;

      tracker.steering += (target - tracker.steering) * LERP;
      lastTwoHandsAt = performance.now();
    } else if (performance.now() - lastTwoHandsAt < GRACE_MS) {
      // A hand briefly dropped (common when turning): hold the last steering and
      // stay "detected" so the game doesn't zero the wheel or auto-pause on a blip.
      tracker.detected = true;
    } else {
      // Hands genuinely gone: ease steering back to center and flag not-detected.
      tracker.detected = false;
      tracker.steering += (0 - tracker.steering) * LERP;
      tracker.tiltDeg += (0 - tracker.tiltDeg) * LERP;
    }
  }

  rafId = requestAnimationFrame(loop);

  function stop() {
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    for (const track of stream.getTracks()) track.stop();
  }

  return tracker;
}
