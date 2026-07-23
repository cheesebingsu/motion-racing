// js/main.js — ES module entry point.
// Wires the webcam hand tracker (hand-tracking.js) to the pseudo-3D racer
// (game.js), and drives the DOM overlays (start / game-over / status / wheel).
//
// NOTE: the webcam (getUserMedia) only works on a secure context — https://
// or http://localhost. Opening index.html via file:// will NOT grant camera
// access, so serve the folder locally (e.g. `python -m http.server`) and open
// it at http://localhost:PORT/ .

import { createHandTracker } from './hand-tracking.js';
import { RacingGame } from './game.js';

// ---- DOM handles ----------------------------------------------------------
const cam = document.getElementById('cam');
const camOverlay = document.getElementById('cam-overlay');
const canvas = document.getElementById('game-canvas');
const status = document.getElementById('status');
const wheel = document.getElementById('wheel');
const startScreen = document.getElementById('start-screen');
const startBtn = document.getElementById('start-btn');
const practiceBtn = document.getElementById('practice-btn');
const menuBtn = document.getElementById('menu-btn');
const gameoverScreen = document.getElementById('gameover-screen');
const restartBtn = document.getElementById('restart-btn');
const difficultyBox = document.getElementById('difficulty');
const sensitivitySlider = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivity-val');

// ---- shared state (tracker/camera is created once, reused across restarts) -
let tracker = null;
let game = null;
let starting = false;
let lastPractice = false;     // remember the mode so restart replays it
let selectedDifficulty = 'medium'; // 'easy' | 'medium' | 'hard'
let selectedSensitivity = 1;  // steering sensitivity multiplier

// ---- status helpers -------------------------------------------------------
function setStatus(text, kind) {
  if (!status) return;
  status.textContent = text || '';
  status.classList.remove('is-warn', 'is-error');
  if (kind) status.classList.add(kind);
}

// ---- start flow (works for both normal and practice mode) -----------------
async function beginGame(practice) {
  if (starting) return;

  lastPractice = !!practice;
  if (startScreen) startScreen.hidden = true;
  if (gameoverScreen) gameoverScreen.hidden = true;

  // Create the camera/tracker once; reuse it on later runs & mode switches.
  if (!tracker) {
    starting = true;
    setStatus('카메라 준비 중...');
    try {
      tracker = await createHandTracker(cam, camOverlay);
    } catch (err) {
      starting = false;
      if (startScreen) startScreen.hidden = false; // let them try again
      setStatus(
        (err && err.message ? err.message : '카메라를 시작하지 못했습니다.') +
          ' — 카메라 권한을 허용하고 localhost 또는 https 에서 실행하세요.',
        'is-error'
      );
      return;
    }
    setStatus('');
    starting = false;
  }

  if (tracker.setSensitivity) tracker.setSensitivity(selectedSensitivity);
  if (!game) game = new RacingGame(canvas, tracker);
  game.stop();                       // in case a game was already running
  game.start({ practice: lastPractice, difficulty: selectedDifficulty });
}

// ---- restart flow (reuse the same tracker / camera + last mode) ------------
function restartGame() {
  if (gameoverScreen) gameoverScreen.hidden = true;
  if (!tracker) return; // shouldn't happen, but stay safe
  if (!game) game = new RacingGame(canvas, tracker);
  game.stop();
  game.start({ practice: lastPractice, difficulty: selectedDifficulty });
}

// ---- back to the main menu (used by the in-game menu button) --------------
function toMenu() {
  if (game) game.stop();
  if (gameoverScreen) gameoverScreen.hidden = true;
  setStatus('');
  if (startScreen) startScreen.hidden = false;
}

// ---- difficulty selector --------------------------------------------------
if (difficultyBox) {
  difficultyBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.difficulty__btn');
    if (!btn) return;
    selectedDifficulty = btn.dataset.diff || 'medium';
    for (const b of difficultyBox.querySelectorAll('.difficulty__btn')) {
      b.classList.toggle('is-selected', b === btn);
    }
  });
}

// ---- sensitivity slider ---------------------------------------------------
if (sensitivitySlider) {
  const applySensitivity = () => {
    selectedSensitivity = parseFloat(sensitivitySlider.value) || 1;
    if (sensitivityVal) sensitivityVal.textContent = selectedSensitivity.toFixed(1) + '×';
    if (tracker && tracker.setSensitivity) tracker.setSensitivity(selectedSensitivity);
  };
  sensitivitySlider.addEventListener('input', applySensitivity);
  applySensitivity(); // initialise label from the default value
}

// ---- wire buttons ---------------------------------------------------------
if (startBtn) startBtn.addEventListener('click', () => beginGame(false));
if (practiceBtn) practiceBtn.addEventListener('click', () => beginGame(true));
if (restartBtn) restartBtn.addEventListener('click', restartGame);
if (menuBtn) menuBtn.addEventListener('click', toMenu);

// ---- UI loop: rotate the wheel + warn when hands aren't detected ----------
function uiLoop() {
  requestAnimationFrame(uiLoop);
  if (!tracker) return;

  // Rotate the on-screen steering-wheel indicator so it turns the SAME direction
  // the user rolls their hands (negate: tiltDeg is in mirrored-image space).
  if (wheel) wheel.style.transform = 'rotate(' + (-tracker.tiltDeg).toFixed(1) + 'deg)';

  // Only nag about hands while a game is actually running.
  const playing = game && game.running;
  if (playing && !tracker.detected) {
    setStatus('양손을 화면에 보여주세요', 'is-warn');
  } else if (playing) {
    setStatus('');
  }
}
requestAnimationFrame(uiLoop);
