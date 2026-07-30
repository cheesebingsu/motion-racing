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
import { applyIcons } from './icons.js';
import { t, initLang, setLang, getLang, applyI18n } from './i18n.js';

// vehicle/map/time display names by id → i18n key (SUV keeps its Latin name)
const VEH_KEY = { sports: 'veh_sports', super: 'veh_super', classic: 'veh_classic' };
const MAP_KEY = { newyork: 'map_newyork', paris: 'map_paris', tokyo: 'map_tokyo', seoul: 'map_seoul', neon: 'map_neon' };
const TIME_KEY = { newyork: 'time_day', paris: 'time_sunset', tokyo: 'time_night', seoul: 'time_evening', neon: 'time_midnight' };
const vehName = (v) => (VEH_KEY[v.id] ? t(VEH_KEY[v.id]) : v.name);
const mapName = (m) => (MAP_KEY[m.id] ? t(MAP_KEY[m.id]) : m.name);
const timeName = (m) => (TIME_KEY[m.id] ? t(TIME_KEY[m.id]) : m.time);
import {
  getProfile, ensureProfile, addRun, submitBest,
  getLocalBest, getHistory, fetchTop, fetchMyRank, remoteEnabled,
} from './ranking.js';

// ---- DOM handles ----------------------------------------------------------
const cam = document.getElementById('cam');
const camOverlay = document.getElementById('cam-overlay');
const canvas = document.getElementById('game-canvas');
const status = document.getElementById('status');
const wheel = document.getElementById('wheel');
const lobbyScreen = document.getElementById('lobby-screen');
const setupScreen = document.getElementById('setup-screen');
const settingsScreen = document.getElementById('settings-screen');
const nickScreen = document.getElementById('nick-screen');
const startBtn = document.getElementById('start-btn');
const practiceBtn = document.getElementById('practice-btn');
const menuBtn = document.getElementById('menu-btn');
const gameoverScreen = document.getElementById('gameover-screen');

// ---- screen navigation (only one screen visible at a time) -----------------
const rankScreenEl = document.getElementById('rank-screen');
const screenEls = {
  lobby: lobbyScreen, setup: setupScreen, settings: settingsScreen,
  nick: nickScreen, rank: rankScreenEl, gameover: gameoverScreen,
};
function hideScreens() { for (const k in screenEls) if (screenEls[k]) screenEls[k].hidden = true; }
function goto(name) { hideScreens(); if (screenEls[name]) screenEls[name].hidden = false; }
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
let selectedView = '3rd'; // '3rd' chase | '1st' cockpit

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
    '<span class="pickcard__name">' + vehName(v) + '</span>' +
    '<div class="pickcard__stats">' + statRow(t('stat_speed'), v.speed) + statRow(t('stat_accel'), v.accel) + statRow(t('stat_handling'), v.handling) + '</div>' +
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
    '<span class="pickcard__name">' + mapName(m) + '</span>' +
    '<span class="pickcard__badge">' + timeName(m) + '</span>' +
    '</button>'
  ).join('');
  grid.onclick = (e) => {
    const c = e.target.closest('.pickcard'); if (!c) return;
    selectedMap = c.dataset.map;
    for (const b of grid.querySelectorAll('.pickcard')) b.classList.toggle('is-selected', b === c);
  };
}
const wizardProgress = document.getElementById('wizard-progress');
function showStep(n) {
  for (const s of document.querySelectorAll('.wstep')) s.hidden = s.dataset.step !== String(n);
  if (wizardProgress) {
    const dots = wizardProgress.querySelectorAll('i');
    dots.forEach((d, i) => d.classList.toggle('on', i < n));
  }
  // On the last step, request the camera NOW (this click is a user gesture and we're
  // not fullscreen yet, so the permission popup is visible). By the time they press
  // 게임 시작, access is already granted and fullscreen can kick in cleanly.
  if (n === 3) ensureTracker();
}
// wizard next/back navigation (only inside the setup screen)
document.addEventListener('click', (e) => {
  const nx = e.target.closest('[data-next]'); if (nx) { showStep(+nx.dataset.next); return; }
  const bk = e.target.closest('[data-back]'); if (bk) { showStep(+bk.dataset.back); }
});
initLang();            // detect/restore language before first paint
applyIcons();          // swap all <span data-ico> placeholders for line-icon SVGs
applyI18n();           // translate static markup
buildVehicleGrid();
buildMapGrid();

// ---- language toggle (lobby + settings) -----------------------------------
function refreshLangUI() {
  applyI18n();
  buildVehicleGrid();
  buildMapGrid();
  for (const b of document.querySelectorAll('.lang-btn')) b.classList.toggle('is-active', b.dataset.lang === getLang());
  if (typeof refreshProfileName === 'function') refreshProfileName();
  if (game) game._lastLivesStr = game._lastScoreStr = game._lastSpeedStr = ''; // relocalize HUD next frame
}
for (const b of document.querySelectorAll('.lang-btn')) {
  b.addEventListener('click', () => { setLang(b.dataset.lang); refreshLangUI(); });
  b.classList.toggle('is-active', b.dataset.lang === getLang()); // initial active state
}

// enter the setup wizard from the lobby
const playBtn = document.getElementById('play-btn');
const setupExit = document.getElementById('setup-exit');
if (playBtn) playBtn.addEventListener('click', () => { showStep(1); goto('setup'); });
if (setupExit) setupExit.addEventListener('click', () => goto('lobby'));

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
  setStatus(t('status_camera_prep'));
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
        (err && err.message ? err.message : t('err_camera_default')) + t('err_camera_suffix'),
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
  hideScreens(); // leave only the game visible

  if (tracker.setSensitivity) tracker.setSensitivity(selectedSensitivity);
  if (!game) { game = new RacingGame(canvas, tracker); game.onGameOver = handleGameOver; }
  game.stop();                       // in case a game was already running
  game.start({ practice: lastPractice, difficulty: selectedDifficulty, vehicle: selectedVehicle, map: selectedMap, view: selectedView });
  if (tracker.setActive) tracker.setActive(true); // run hand detection only while playing
  document.body.classList.add('playing'); // hide title chrome → maximise the game
}

// ---- back to the lobby (used by pause-menu + game-over) --------------------
function toMenu() {
  if (game) game.stop();
  if (tracker && tracker.setActive) tracker.setActive(false); // stop detection in menus
  setStatus('');
  const pm = document.getElementById('pausemenu-screen');
  if (pm) pm.hidden = true;
  document.body.classList.remove('playing'); // bring the chrome back
  goto('lobby');
}
const gameoverHome = document.getElementById('gameover-home');
if (gameoverHome) gameoverHome.addEventListener('click', toMenu);

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

// ---- view (camera) selector -----------------------------------------------
const viewBox = document.getElementById('viewsel');
if (viewBox) {
  viewBox.addEventListener('click', (e) => {
    const btn = e.target.closest('.difficulty__btn');
    if (!btn) return;
    selectedView = btn.dataset.view || '3rd';
    for (const b of viewBox.querySelectorAll('.difficulty__btn')) {
      b.classList.toggle('is-selected', b === btn);
    }
  });
}

// ---- nickname (first-launch welcome + later edit) -------------------------
const nickInput = document.getElementById('nick-input');
const nickOk = document.getElementById('nick-ok');
const nickTitle = document.getElementById('nick-title');
const nickSub = document.getElementById('nick-sub');
const profileChip = document.getElementById('profile-chip');
const profileName = document.getElementById('profile-name');
function refreshProfileName() {
  const p = getProfile();
  if (profileName) profileName.textContent = p ? p.nickname : t('default_nickname');
}
function showNick(editing) {
  const p = getProfile();
  if (nickTitle) nickTitle.textContent = editing ? t('nick_edit_title') : t('nick_welcome');
  if (nickSub) nickSub.textContent = editing ? t('nick_edit_prompt') : t('nick_prompt');
  if (nickOk) nickOk.textContent = editing ? t('btn_save') : t('btn_nick_start');
  if (nickInput) nickInput.value = p ? p.nickname : '';
  goto('nick');
  if (nickInput) setTimeout(() => nickInput.focus(), 0);
}
function saveNick() {
  const v = (nickInput.value || '').trim();
  if (v.length < 1) { nickInput.focus(); return; }
  ensureProfile(v);
  refreshProfileName();
  goto('lobby');
}
if (nickOk) nickOk.addEventListener('click', saveNick);
if (nickInput) nickInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveNick(); });
if (profileChip) profileChip.addEventListener('click', () => showNick(true));

// ---- settings screen ------------------------------------------------------
const settingsOpenBtn = document.getElementById('settings-open');
const settingsCloseBtn = document.getElementById('settings-close');
if (settingsOpenBtn) settingsOpenBtn.addEventListener('click', () => goto('settings'));
if (settingsCloseBtn) settingsCloseBtn.addEventListener('click', () => goto('lobby'));

// ---- initial screen: lobby if we know the player, else welcome ------------
refreshProfileName();
if (getProfile()) goto('lobby'); else showNick(false);

// ---- game over → record score ---------------------------------------------
let lastResult = null;
function handleGameOver({ distance, difficulty, practice }) {
  if (tracker && tracker.setActive) tracker.setActive(false); // game ended → stop detection
  const badge = document.getElementById('rank-newbest');
  if (practice) { if (badge) badge.hidden = true; lastResult = null; return; } // 연습모드 집계 제외
  const { isBest } = addRun(difficulty, distance);
  lastResult = { distance, difficulty, isBest };
  if (badge) badge.hidden = !isBest;
  if (isBest) submitBest(difficulty, distance); // 신기록만 원격 upsert
}

// ---- ranking page ---------------------------------------------------------
const rankTabs = document.getElementById('rank-tabs');
let rankDiff = 'medium';
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
async function renderRank(diff) {
  rankDiff = diff;
  for (const t of rankTabs.querySelectorAll('.rank__tab')) t.classList.toggle('is-selected', t.dataset.diff === diff);
  const me = getProfile();
  const globalEl = document.getElementById('rank-global');
  const myrankEl = document.getElementById('rank-myrank');
  const mineEl = document.getElementById('rank-mine');
  const myBest = getLocalBest(diff);

  // 내 기록 (로컬, 즉시)
  const hist = getHistory(diff);
  mineEl.innerHTML = hist.length
    ? hist.map((r) => '<li' + (r.distance === myBest ? ' class="is-me"' : '') + '><span>·</span><b>' +
        new Date(r.ts).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) +
        '</b><em>' + r.distance + ' m</em></li>').join('')
    : '<li class="rank__empty">' + t('rank_my_empty') + '</li>';

  // 전체 랭킹 (원격)
  if (remoteEnabled()) {
    globalEl.innerHTML = '<li class="rank__loading">' + t('rank_loading') + '</li>';
    myrankEl.textContent = '';
    const rows = await fetchTop(diff, 100);
    if (rankDiff !== diff) return; // 로딩 중 탭이 바뀜
    globalEl.innerHTML = rows.length
      ? rows.map((r, i) => '<li' + (me && r.player_id === me.playerId ? ' class="is-me"' : '') + '><span>' +
          (i + 1) + '</span><b>' + escapeHtml(r.nickname) + '</b><em>' + r.distance + ' m</em></li>').join('')
      : '<li class="rank__empty">' + t('rank_global_empty') + '</li>';
    const myRank = await fetchMyRank(diff, myBest);
    if (rankDiff === diff) myrankEl.textContent = myRank ? t('rank_my_rank', { n: myRank, best: myBest }) : '';
  } else {
    globalEl.innerHTML = '<li class="rank__empty">' + t('rank_offline') + '</li>';
    myrankEl.textContent = '';
  }
}
let rankReturn = 'lobby';
function openRank(diff, from) { rankReturn = from || 'lobby'; goto('rank'); renderRank(diff || rankDiff); }
if (rankTabs) rankTabs.addEventListener('click', (e) => { const b = e.target.closest('.rank__tab'); if (b) renderRank(b.dataset.diff); });
const rankOpenBtn = document.getElementById('rank-open');
const rankOpenOverBtn = document.getElementById('rank-open-over');
const rankCloseBtn = document.getElementById('rank-close');
if (rankOpenBtn) rankOpenBtn.addEventListener('click', () => openRank(selectedDifficulty, 'lobby'));
if (rankOpenOverBtn) rankOpenOverBtn.addEventListener('click', () => openRank(lastResult ? lastResult.difficulty : selectedDifficulty, 'gameover'));
if (rankCloseBtn) rankCloseBtn.addEventListener('click', () => goto(rankReturn));

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

// ---- pause menu (in-game ⏸ 메뉴 → pause only; resume / go to lobby) --------
const pausemenuScreen = document.getElementById('pausemenu-screen');
const resumeBtn = document.getElementById('resume-btn');
const lobbyBtn = document.getElementById('lobby-btn');
function openPauseMenu() {
  if (!game || !game.running || game.gameOver) return;
  if (game.pauseForMenu) game.pauseForMenu();
  if (pausemenuScreen) pausemenuScreen.hidden = false;
}
function resumeGame() {
  if (pausemenuScreen) pausemenuScreen.hidden = true;
  if (game && game.resumeFromMenu) game.resumeFromMenu();
}
if (resumeBtn) resumeBtn.addEventListener('click', resumeGame);
if (lobbyBtn) lobbyBtn.addEventListener('click', () => { if (pausemenuScreen) pausemenuScreen.hidden = true; toMenu(); });

// ---- wire buttons ---------------------------------------------------------
if (startBtn) startBtn.addEventListener('click', () => beginGame(false));
if (practiceBtn) practiceBtn.addEventListener('click', () => beginGame(true));
if (menuBtn) menuBtn.addEventListener('click', openPauseMenu);

// ---- UI loop: rotate the wheel + warn when hands aren't detected ----------
function uiLoop() {
  requestAnimationFrame(uiLoop);
  if (!tracker) return;

  const playing = game && game.running;
  if (!playing) return; // in menus: no wheel/style writes, no status churn

  // Rotate the cockpit steering wheel so it turns the SAME direction the user
  // rolls their hands (negate: tiltDeg is in mirrored-image space). Keep the
  // bottom-centre positioning transform intact.
  if (wheel) wheel.style.transform = 'translateX(-50%) rotate(' + (-tracker.tiltDeg).toFixed(1) + 'deg)';

  if (!tracker.detected) setStatus(t('status_show_hands'), 'is-warn');
  else setStatus('');
}
requestAnimationFrame(uiLoop);
