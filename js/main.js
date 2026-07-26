// js/main.js — ES module entry point.
// Wires the webcam hand tracker (hand-tracking.js) to the pseudo-3D racer
// (game.js), and drives the DOM overlays (start / game-over / status / wheel).
//
// NOTE: the webcam (getUserMedia) only works on a secure context — https://
// or http://localhost. Opening index.html via file:// will NOT grant camera
// access, so serve the folder locally (e.g. `python -m http.server`) and open
// it at http://localhost:PORT/ .

import { createHandTracker } from './hand-tracking.js';
import { RacingGame3D as RacingGame, VEHICLES, MAPS } from './game3d.js';

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
const fullscreenBtn = document.getElementById('fullscreen-btn');

// ---- fullscreen (hides the mobile browser bars that cover the top ~1/3) ----
function enterFullscreen() {
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    try { const p = req.call(el); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }
  if (screen.orientation && screen.orientation.lock) {
    try { const p = screen.orientation.lock('landscape'); if (p && p.catch) p.catch(() => {}); } catch (_) {}
  }
}
function toggleFullscreen() {
  if (document.fullscreenElement) { if (document.exitFullscreen) document.exitFullscreen(); }
  else enterFullscreen();
}
if (fullscreenBtn) fullscreenBtn.addEventListener('click', toggleFullscreen);

// ---- shared state (tracker/camera is created once, reused across restarts) -
let tracker = null;
let trackerPromise = null;    // shared so step-3 prewarm and 게임 시작 don't double-request
let game = null;
let lastPractice = false;     // remember the mode so restart replays it
let selectedDifficulty = 'medium'; // 'easy' | 'medium' | 'hard'
let selectedSensitivity = 1;  // steering sensitivity multiplier
let selectedVehicle = VEHICLES[0].id;
let selectedMap = MAPS[0].id;

// ---- home wizard: vehicle / map selection ---------------------------------
// 5-pip rating (●●●○○) — far easier to read at a glance than a thin bar.
function statRating(v) {
  return v < 0.85 ? 1 : v < 0.93 ? 2 : v < 1.02 ? 3 : v < 1.12 ? 4 : 5;
}
function statRow(label, v) {
  const n = statRating(v);
  let pips = '';
  for (let i = 0; i < 5; i++) pips += '<i class="' + (i < n ? 'on' : '') + '"></i>';
  return '<div class="stat"><span>' + label + '</span><div class="pips">' + pips + '</div></div>';
}
function buildVehicleGrid() {
  const grid = document.getElementById('vehicle-grid');
  if (!grid) return;
  grid.innerHTML = VEHICLES.map((v) =>
    '<button class="pickcard' + (v.id === selectedVehicle ? ' is-selected' : '') + '" data-veh="' + v.id + '">' +
    '<span class="pickcard__name">' + v.name + '</span>' +
    '<div class="pickcard__stats">' + statRow('속도', v.speed) + statRow('가속', v.accel) + statRow('조향', v.handling) + '</div>' +
    '</button>'
  ).join('');
  grid.onclick = (e) => {
    const c = e.target.closest('.pickcard'); if (!c) return;
    selectedVehicle = c.dataset.veh;
    for (const b of grid.querySelectorAll('.pickcard')) b.classList.toggle('is-selected', b === c);
  };
}
function buildMapGrid() {
  const grid = document.getElementById('map-grid');
  if (!grid) return;
  grid.innerHTML = MAPS.map((m) =>
    '<button class="pickcard pickcard--map' + (m.id === selectedMap ? ' is-selected' : '') + '" data-map="' + m.id + '">' +
    '<span class="pickcard__name">' + m.name + '</span>' +
    '<span class="pickcard__badge">' + m.time + '</span>' +
    '</button>'
  ).join('');
  grid.onclick = (e) => {
    const c = e.target.closest('.pickcard'); if (!c) return;
    selectedMap = c.dataset.map;
    for (const b of grid.querySelectorAll('.pickcard')) b.classList.toggle('is-selected', b === c);
  };
}
function showStep(n) {
  for (const s of document.querySelectorAll('.wstep')) s.hidden = s.dataset.step !== String(n);
  // On the last step, request the camera NOW (this click is a user gesture and we're
  // not fullscreen yet, so the permission popup is visible). By the time they press
  // 게임 시작, access is already granted and fullscreen can kick in cleanly.
  if (n === 3) ensureTracker();
}
document.addEventListener('click', (e) => {
  const nx = e.target.closest('[data-next]'); if (nx) { showStep(+nx.dataset.next); return; }
  const bk = e.target.closest('[data-back]'); if (bk) { showStep(+bk.dataset.back); }
});
buildVehicleGrid();
buildMapGrid();
showStep(1);

// ---- status helpers -------------------------------------------------------
function setStatus(text, kind) {
  if (!status) return;
  status.textContent = text || '';
  status.classList.remove('is-warn', 'is-error');
  if (kind) status.classList.add(kind);
}

// Create the camera/tracker once; reuse it across runs & mode switches.
// Shared promise so the step-3 prewarm and 게임 시작 never double-request.
function ensureTracker() {
  if (tracker) return Promise.resolve(tracker);
  if (trackerPromise) return trackerPromise;
  setStatus('카메라 준비 중... 권한을 허용해 주세요');
  trackerPromise = createHandTracker(cam, camOverlay)
    .then((t) => {
      tracker = t;
      if (tracker.setSensitivity) tracker.setSensitivity(selectedSensitivity);
      setStatus('');
      return tracker;
    })
    .catch((err) => {
      trackerPromise = null; // allow another attempt
      setStatus(
        (err && err.message ? err.message : '카메라를 시작하지 못했습니다.') +
          ' — 카메라 권한을 허용하고 localhost 또는 https 에서 실행하세요.',
        'is-error'
      );
      return null;
    });
  return trackerPromise;
}

// ---- start flow (works for both normal and practice mode) -----------------
async function beginGame(practice) {
  lastPractice = !!practice;

  // 1) Camera permission FIRST — the popup is visible because we're not yet
  //    fullscreen. (Usually already granted during step 3, so this is instant.)
  const t = await ensureTracker();
  if (!t) return; // denied/failed → stay on the start screen with the error shown

  // 2) Access granted → now go fullscreen (still inside the click's activation).
  enterFullscreen();
  if (startScreen) startScreen.hidden = true;
  if (gameoverScreen) gameoverScreen.hidden = true;

  if (tracker.setSensitivity) tracker.setSensitivity(selectedSensitivity);
  if (!game) game = new RacingGame(canvas, tracker);
  game.stop();                       // in case a game was already running
  game.start({ practice: lastPractice, difficulty: selectedDifficulty, vehicle: selectedVehicle, map: selectedMap });
  document.body.classList.add('playing'); // hide title chrome → maximise the game
}

// ---- restart flow (reuse the same tracker / camera + last mode) ------------
function restartGame() {
  if (gameoverScreen) gameoverScreen.hidden = true;
  if (!tracker) return; // shouldn't happen, but stay safe
  if (!game) game = new RacingGame(canvas, tracker);
  game.stop();
  game.start({ practice: lastPractice, difficulty: selectedDifficulty, vehicle: selectedVehicle, map: selectedMap });
}

// ---- back to the main menu (used by the in-game menu button) --------------
function toMenu() {
  if (game) game.stop();
  if (gameoverScreen) gameoverScreen.hidden = true;
  setStatus('');
  document.body.classList.remove('playing'); // bring the title chrome back
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

  // Rotate the cockpit steering wheel so it turns the SAME direction the user
  // rolls their hands (negate: tiltDeg is in mirrored-image space). Keep the
  // bottom-centre positioning transform intact.
  if (wheel) wheel.style.transform = 'translateX(-50%) rotate(' + (-tracker.tiltDeg).toFixed(1) + 'deg)';

  // Only nag about hands while a game is actually running.
  const playing = game && game.running;
  if (playing && !tracker.detected) {
    setStatus('양손을 화면에 보여주세요', 'is-warn');
  } else if (playing) {
    setStatus('');
  }
}
requestAnimationFrame(uiLoop);
