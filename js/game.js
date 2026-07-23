// js/game.js
// RacingGame: pseudo-3D endless racer drawn on Canvas 2D.
// Reads a live `tracker` (from createHandTracker) for steering each frame.
// NOTE: webcam-based tracker requires localhost or https to work.

// ---- tunables -------------------------------------------------------------
// Landscape 16:9 canvas (like KartRider / PC racers). Play a phone in landscape.
const CANVAS_W = 960;
const CANVAS_H = 540;

const HORIZON_Y = CANVAS_H * 0.30;      // vanishing point raised → longer road, more reaction time
const ROAD_NEAR_HALF = CANVAS_W * 0.46; // half road width at the bottom (near) — wider road
const ROAD_FAR_HALF = CANVAS_W * 0.06;  // half road width at the horizon — wider vanishing point
const BEND_MAX = CANVAS_W * 0.30;       // max horizontal road bend at the horizon

const STEER_MOVE = 360;    // how fast the car slides across the road per steering unit

const PLAYER_Y = CANVAS_H - 70;
const PLAYER_W = 60;
const PLAYER_H = 78;

const OBST_BASE_W = 58;
const OBST_BASE_H = 76;

const START_LIVES = 3;
const INVULN_TIME = 1.6;   // seconds of flashing invulnerability after a hit
const NO_HANDS_GRACE = 0.4; // seconds of no-hands before the game auto-pauses

// Difficulty presets — start speed + obstacle density.
//   startSpeed/maxSpeed/accel: forward speed curve (units/sec; HUD shows /3 km/h)
//   spawnBase: base seconds between obstacle spawns (smaller = more obstacles)
//   burst: how many obstacles spawn at once
const DIFFICULTY = {
  easy:   { key: 'easy',   label: '쉬움',   startSpeed: 150, maxSpeed: 520,  accel: 5,  spawnBase: 1.25, burst: 1 },
  medium: { key: 'medium', label: '중간',   startSpeed: 220, maxSpeed: 880,  accel: 9,  spawnBase: 0.75, burst: 1 },
  hard:   { key: 'hard',   label: '어려움', startSpeed: 340, maxSpeed: 1150, accel: 14, spawnBase: 0.42, burst: 2 },
};

// Colors (kept local; CSS variables don't reach the canvas).
const C = {
  skyTop: '#0a0a1f',
  skyMid: '#241a4a',
  skyHorizon: '#5a3a6b',
  sun: '#ff9d5c',
  hill: '#1a1330',
  grassLight: '#1a4d28',
  grassDark: '#123d1e',
  asphalt: '#3b3e48',
  asphaltDark: '#31323a',
  rumbleLight: '#eef0f4',
  rumbleDark: '#c0392b',
  edge: '#f2f2f2',
  lane: '#f5d13b',    // yellow centre line
  trunk: '#5b3a22',
  foliage1: '#1f6b3a',
  foliage2: '#16512e',
  pole: '#8892a0',
  lamp: '#ffd98a',
  player: '#2ec7ff',
  playerDark: '#0f6fa4',
  tail: '#ff2b2b',    // glowing tail-lights
};

// Varied obstacle car colours (assigned per obstacle at spawn).
const CAR_COLORS = [
  { body: '#ff5a3c', dark: '#b8331e' },
  { body: '#ffd23c', dark: '#c79a17' },
  { body: '#6cff7a', dark: '#2fa843' },
  { body: '#c05cff', dark: '#7a2fb8' },
  { body: '#ff5ab0', dark: '#c02f7a' },
  { body: '#eaf0ff', dark: '#9aa0ac' },
];

// project a world half-width at a given screen y (linear perspective)
function roadHalfAt(y) {
  const t = (y - HORIZON_Y) / (CANVAS_H - HORIZON_Y); // 0 at horizon, 1 at bottom
  const tc = Math.max(0, Math.min(1, t));
  return ROAD_FAR_HALF + (ROAD_NEAR_HALF - ROAD_FAR_HALF) * tc;
}

// perspective scale (0 at horizon -> 1 at bottom), used to size sprites
function depthScale(y) {
  const t = (y - HORIZON_Y) / (CANVAS_H - HORIZON_Y);
  return Math.max(0, Math.min(1, t));
}

// horizontal center of the road at screen y, given the current bend (curve)
function roadCenterX(y, curve) {
  const s = depthScale(y);
  const bend = curve * (1 - s) * (1 - s) * BEND_MAX;
  return CANVAS_W / 2 + bend;
}

export class RacingGame {
  constructor(canvas, tracker) {
    this.canvas = canvas;
    this.tracker = tracker || { steering: 0, detected: false, tiltDeg: 0 };
    this.ctx = canvas.getContext('2d');

    canvas.width = CANVAS_W;
    canvas.height = CANVAS_H;

    // HUD elements (looked up once; text updated only on change).
    this.hudScore = document.getElementById('hud-score');
    this.hudLives = document.getElementById('hud-lives');
    this.hudSpeed = document.getElementById('hud-speed');
    this.gameoverScreen = document.getElementById('gameover-screen');
    this.finalScore = document.getElementById('final-score');

    this._loop = this._loop.bind(this);
    this._resetState();
  }

  _resetState() {
    this.running = false;
    this.rafId = 0;
    this.lastTime = 0;

    this.speed = (this.diff || DIFFICULTY.medium).startSpeed; // forward speed
    this.distance = 0;             // score, in meters
    this.lives = START_LIVES;

    this.playerX = 0;              // -1..1 across the road (0 = center)
    this.roadOffset = 0;          // accumulated scroll for stripes
    this.curve = 0;                // smoothed road bend from steering

    this.obstacles = [];           // { lane:-1..1, y, hit, color }
    this.spawnTimer = 0;

    this.scenery = [];             // roadside trees / lamp posts { side, lane, y, type }
    this.scenTimer = 0;

    this.invuln = 0;               // remaining invulnerability seconds
    this.gameOver = false;
    this.practice = false;         // practice mode: no obstacles / no collisions
    this.countdown = 0;
    this.paused = false;           // auto-paused because hands left the camera
    this.noHandsTimer = 0;         // how long hands have been missing

    // cache last HUD strings to avoid per-frame DOM writes
    this._lastScoreStr = '';
    this._lastLivesStr = '';
    this._lastSpeedStr = '';
  }

  start(opts) {
    if (this.running) return;
    this.diff = DIFFICULTY[opts && opts.difficulty] || DIFFICULTY.medium;
    this._resetState();
    this.practice = !!(opts && opts.practice);
    this.countdown = 3;
    if (this.gameoverScreen) this.gameoverScreen.hidden = true;
    this.running = true;
    this.lastTime = performance.now();
    this._updateHud();
    this.rafId = requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  _loop(now) {
    if (!this.running) return;
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.05) dt = 0.05; // clamp after tab-switch / hiccups

    this._update(dt);
    this._render();

    if (this.running) this.rafId = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    // Pre-race countdown: let the player get their hands on the wheel.
    if (this.countdown > 0) {
      this.countdown -= dt;
      // When the countdown ends, lock the current hand pose as "straight".
      // Absorbs camera rotation (phone in landscape) and the user's resting angle.
      if (this.countdown <= 0 && typeof this.tracker.calibrate === 'function') {
        this.tracker.calibrate();
      }
      // The car stays put during the get-ready countdown (and thus while paused):
      // turning the wheel must NOT move the car yet. Only ease the road straight.
      this.curve += (0 - this.curve) * Math.min(1, dt * 4);
      this._updateHud();
      return;
    }

    // Auto-pause when the wheel (both hands) leaves the camera; resume with a
    // fresh 3-second countdown once the hands come back into view.
    if (this.tracker.detected) {
      this.noHandsTimer = 0;
      if (this.paused) {
        this.paused = false;
        this.countdown = 3;   // "이어서 시작" also gets a 3-2-1 prep
        this._updateHud();
        return;
      }
    } else {
      this.noHandsTimer += dt;
      if (!this.paused && this.noHandsTimer > NO_HANDS_GRACE) {
        this.paused = true;
      }
    }
    if (this.paused) {
      this._updateHud();
      return;   // freeze all progression while paused
    }

    const steering = clamp(this.tracker.steering || 0, -1, 1);

    // auto-accelerate (per-difficulty curve)
    this.speed = Math.min(this.diff.maxSpeed, this.speed + this.diff.accel * dt);

    // distance / score: ~ speed scaled to meters
    this.distance += this.speed * dt * 0.05;

    // steer the car; sensitivity tapers a touch at high speed
    this.playerX += steering * STEER_MOVE * dt / ROAD_NEAR_HALF;
    this.playerX = clamp(this.playerX, -0.92, 0.92);

    // road visually bends toward the steer direction (smoothed)
    const targetCurve = steering;
    this.curve += (targetCurve - this.curve) * Math.min(1, dt * 4);

    // scroll stripes based on speed
    this.roadOffset = (this.roadOffset + this.speed * dt) % 80;

    // invulnerability countdown
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // Roadside scenery (both modes) — rushes past for a sense of speed.
    const smove = this.speed * dt;
    for (const o of this.scenery) o.y += smove * (0.6 + depthScale(o.y) * 1.4);
    this.scenery = this.scenery.filter((o) => o.y < CANVAS_H + 160);
    this.scenTimer -= dt;
    if (this.scenTimer <= 0) {
      this.scenTimer = 0.5;
      const side = Math.random() < 0.5 ? -1 : 1;
      this.scenery.push({
        side,
        lane: side * (1.25 + Math.random() * 0.35),
        y: HORIZON_Y + 2,
        type: Math.random() < 0.7 ? 0 : 1 // 0 = tree, 1 = lamp post
      });
    }

    // Obstacles + collisions are skipped entirely in practice mode.
    if (!this.practice) {
      // spawn obstacles; faster speed => more frequent; difficulty sets the base
      this.spawnTimer -= dt;
      const spawnInterval = Math.max(
        0.26,
        this.diff.spawnBase * (this.diff.startSpeed / this.speed) + 0.14
      );
      if (this.spawnTimer <= 0) {
        this.spawnTimer = spawnInterval;
        for (let b = 0; b < this.diff.burst; b++) this._spawnObstacle();
      }

      // advance obstacles toward the player (down the screen).
      // Slower far away (near the vanishing point) so they emerge gradually and
      // the player can react; accelerates only as they get close.
      const move = this.speed * dt;
      for (const o of this.obstacles) {
        o.y += move * (0.4 + depthScale(o.y) * 1.15);
      }
      this.obstacles = this.obstacles.filter((o) => o.y < CANVAS_H + 120);

      this._checkCollisions();
    }

    this._updateHud();
  }

  _spawnObstacle() {
    // pick a lane offset -0.7..0.7 and a random car colour
    const lane = (Math.random() * 1.4) - 0.7;
    const color = CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)];
    this.obstacles.push({ lane, y: HORIZON_Y + 2, hit: false, color });
  }

  _checkCollisions() {
    if (this.invuln > 0) return;

    const p = this._playerRect();
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const r = this._obstacleRect(o);
      if (r.y + r.h < p.y) continue; // still far up-screen
      if (aabb(p, r)) {
        o.hit = true;
        this.lives -= 1;
        this.invuln = INVULN_TIME;
        if (this.lives <= 0) {
          this.lives = 0;
          this._endGame();
        }
        break;
      }
    }
  }

  _playerRect() {
    const half = roadHalfAt(PLAYER_Y);
    const cx = roadCenterX(PLAYER_Y, this.curve) + this.playerX * half;
    return { x: cx - PLAYER_W / 2, y: PLAYER_Y - PLAYER_H / 2, w: PLAYER_W, h: PLAYER_H, cx, cy: PLAYER_Y };
  }

  _obstacleRect(o) {
    const s = depthScale(o.y);
    const w = OBST_BASE_W * (0.32 + s * 0.8);
    const h = OBST_BASE_H * (0.32 + s * 0.8);
    const half = roadHalfAt(o.y);
    const cx = roadCenterX(o.y, this.curve) + o.lane * half;
    return { x: cx - w / 2, y: o.y - h / 2, w, h, cx, cy: o.y, s };
  }

  _endGame() {
    this.stop();
    this.gameOver = true;
    const dist = Math.floor(this.distance);
    if (this.finalScore) this.finalScore.textContent = '최종 거리: ' + dist + ' m';
    if (this.gameoverScreen) this.gameoverScreen.hidden = false;
  }

  // ---- HUD --------------------------------------------------------------
  _updateHud() {
    const scoreStr = '거리: ' + Math.floor(this.distance) + ' m';
    if (scoreStr !== this._lastScoreStr && this.hudScore) {
      this.hudScore.textContent = scoreStr;
      this._lastScoreStr = scoreStr;
    }
    const livesStr = this.practice
      ? '🟢 연습'
      : this.lives > 0 ? '❤'.repeat(this.lives) : '💀';
    if (livesStr !== this._lastLivesStr && this.hudLives) {
      this.hudLives.textContent = livesStr;
      this._lastLivesStr = livesStr;
    }
    const speedStr = '속도: ' + Math.floor(this.speed / 3) + ' km/h';
    if (speedStr !== this._lastSpeedStr && this.hudSpeed) {
      this.hudSpeed.textContent = speedStr;
      this._lastSpeedStr = speedStr;
    }
  }

  // ---- rendering --------------------------------------------------------
  _render() {
    const ctx = this.ctx;
    this._drawSky(ctx);
    this._drawRoad(ctx);
    this._drawScenery(ctx);
    this._drawObstacles(ctx);
    this._drawPlayer(ctx);
    this._drawVignette(ctx);
    if (this.countdown > 0) this._drawCountdown(ctx);
    else if (this.paused) this._drawPause(ctx);
  }

  _drawPause(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 15, 0.55)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd23c';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.1) + 'px "Segoe UI", sans-serif';
    ctx.fillText('⏸ 일시정지', CANVAS_W / 2, CANVAS_H * 0.42);
    ctx.fillStyle = '#eaf0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillText('양손을 화면에 보여주면 이어서 시작해요', CANVAS_W / 2, CANVAS_H * 0.56);
    ctx.restore();
  }

  _drawSky(ctx) {
    // dusk gradient sky
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    g.addColorStop(0, C.skyTop);
    g.addColorStop(0.55, C.skyMid);
    g.addColorStop(1, C.skyHorizon);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y);

    // low sun glow near the horizon (drifts slightly with the road curve)
    const sunX = CANVAS_W / 2 - this.curve * 70;
    const sunY = HORIZON_Y - 6;
    const rg = ctx.createRadialGradient(sunX, sunY, 4, sunX, sunY, 150);
    rg.addColorStop(0, C.sun);
    rg.addColorStop(0.28, 'rgba(255,150,90,0.45)');
    rg.addColorStop(1, 'rgba(255,150,90,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y);

    // distant hill silhouette
    ctx.fillStyle = C.hill;
    ctx.beginPath();
    ctx.moveTo(0, HORIZON_Y);
    ctx.lineTo(0, HORIZON_Y - 20);
    ctx.quadraticCurveTo(CANVAS_W * 0.2, HORIZON_Y - 46, CANVAS_W * 0.4, HORIZON_Y - 22);
    ctx.quadraticCurveTo(CANVAS_W * 0.58, HORIZON_Y - 50, CANVAS_W * 0.78, HORIZON_Y - 26);
    ctx.quadraticCurveTo(CANVAS_W * 0.9, HORIZON_Y - 40, CANVAS_W, HORIZON_Y - 22);
    ctx.lineTo(CANVAS_W, HORIZON_Y);
    ctx.closePath();
    ctx.fill();

    // grass fills the rest as base
    ctx.fillStyle = C.grassDark;
    ctx.fillRect(0, HORIZON_Y, CANVAS_W, CANVAS_H - HORIZON_Y);
  }

  _drawRoad(ctx) {
    // Draw road as horizontal scanline bands so we can color grass/rumble/road
    // and apply a per-row curve offset for the pseudo-3D bend.
    const rows = CANVAS_H - HORIZON_Y;
    for (let i = 0; i <= rows; i += 2) {
      const y = HORIZON_Y + i;
      const s = depthScale(y);
      const half = roadHalfAt(y);
      // curve pushes the road center sideways more strongly toward the horizon
      const cx = roadCenterX(y, this.curve);

      // alternating band color based on scrolling offset & depth
      const band = Math.floor((i + this.roadOffset) / (6 + s * 26)) % 2 === 0;

      // grass
      ctx.fillStyle = band ? C.grassLight : C.grassDark;
      ctx.fillRect(0, y, CANVAS_W, 2);

      // rumble strip (outer edge)
      const rumbleHalf = half + 10 + s * 8;
      ctx.fillStyle = band ? C.rumbleLight : C.rumbleDark;
      ctx.fillRect(cx - rumbleHalf, y, rumbleHalf * 2, 2);

      // asphalt
      ctx.fillStyle = band ? C.asphalt : C.asphaltDark;
      ctx.fillRect(cx - half, y, half * 2, 2);

      // solid white edge lines just inside the asphalt
      if (s > 0.05) {
        const ew = Math.max(1.2, 4 * s);
        ctx.fillStyle = C.edge;
        ctx.fillRect(cx - half + ew * 0.5, y, ew, 2);
        ctx.fillRect(cx + half - ew * 1.5, y, ew, 2);
      }

      // dashed yellow centre line
      if (band && s > 0.06) {
        const laneW = Math.max(1.5, 5 * s);
        ctx.fillStyle = C.lane;
        ctx.fillRect(cx - laneW / 2, y, laneW, 2);
      }
    }
  }

  // ---- roadside scenery -------------------------------------------------
  _drawScenery(ctx) {
    const sorted = [...this.scenery].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const s = depthScale(o.y);
      if (s <= 0.02) continue;
      const half = roadHalfAt(o.y);
      const cx = roadCenterX(o.y, this.curve) + o.lane * half;
      if (o.type === 0) this._drawTree(ctx, cx, o.y, s);
      else this._drawPole(ctx, cx, o.y, s);
    }
  }

  _drawTree(ctx, cx, baseY, s) {
    const h = 130 * s;
    const w = 48 * s;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(cx, baseY, w * 0.5, h * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    // trunk
    ctx.fillStyle = C.trunk;
    ctx.fillRect(cx - w * 0.08, baseY - h * 0.34, w * 0.16, h * 0.34);
    // foliage (layered blobs)
    ctx.fillStyle = C.foliage2;
    ctx.beginPath();
    ctx.arc(cx, baseY - h * 0.52, w * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.foliage1;
    ctx.beginPath();
    ctx.arc(cx - w * 0.2, baseY - h * 0.64, w * 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + w * 0.22, baseY - h * 0.6, w * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawPole(ctx, cx, baseY, s) {
    const h = 140 * s;
    const w = Math.max(1.5, 11 * s);
    ctx.fillStyle = C.pole;
    ctx.fillRect(cx - w * 0.5, baseY - h, w, h);
    // lamp arm reaching toward the road
    const arm = -Math.sign(cx - CANVAS_W / 2) || 1;
    ctx.fillRect(cx, baseY - h, arm * w * 2.4, w * 0.7);
    // glowing lamp head
    ctx.save();
    ctx.shadowColor = 'rgba(255,210,120,0.85)';
    ctx.shadowBlur = 10 * s;
    ctx.fillStyle = C.lamp;
    ctx.beginPath();
    ctx.arc(cx + arm * w * 2.2, baseY - h + w * 0.5, w * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H * 0.55, CANVAS_H * 0.32,
      CANVAS_W / 2, CANVAS_H * 0.55, CANVAS_H * 0.85
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.34)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  _drawObstacles(ctx) {
    // draw far-to-near so nearer ones overlap correctly
    const sorted = [...this.obstacles].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const r = this._obstacleRect(o);
      const col = o.color || CAR_COLORS[0];
      this._drawCar(ctx, r.cx, r.cy, r.w, r.h, col.body, col.dark);
    }
  }

  _drawPlayer(ctx) {
    // flash during invulnerability
    if (this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;
    const p = this._playerRect();
    this._drawCar(ctx, p.cx, p.cy, p.w, p.h, C.player, C.playerDark);
  }

  _drawCountdown(ctx) {
    const n = Math.ceil(this.countdown);
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 15, 0.45)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(35, 224, 255, 0.85)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#23e0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.24) + 'px "Segoe UI", sans-serif';
    ctx.fillText(String(n), CANVAS_W / 2, CANVAS_H * 0.42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillText('양손으로 핸들을 잡으세요 · 이 자세가 직진이에요', CANVAS_W / 2, CANVAS_H * 0.62);
    ctx.restore();
  }

  _drawCar(ctx, cx, cy, w, h, body, dark) {
    const x = cx - w / 2;
    const y = cy - h / 2;
    const r = Math.min(12, w * 0.2);

    // ground shadow
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(cx, y + h - 3, w * 0.6, h * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();

    // wheels (drawn behind the body so they peek out at the sides)
    ctx.fillStyle = '#0a0a0c';
    const ww = w * 0.19, wh = h * 0.26;
    roundRect(ctx, x - ww * 0.32, y + h * 0.15, ww, wh, 3); ctx.fill();
    roundRect(ctx, x + w - ww * 0.68, y + h * 0.15, ww, wh, 3); ctx.fill();
    roundRect(ctx, x - ww * 0.32, y + h * 0.60, ww, wh, 3); ctx.fill();
    roundRect(ctx, x + w - ww * 0.68, y + h * 0.60, ww, wh, 3); ctx.fill();

    // body with a vertical gradient for volume
    const bg = ctx.createLinearGradient(x, y, x, y + h);
    bg.addColorStop(0, lighten(body, 0.35));
    bg.addColorStop(0.5, body);
    bg.addColorStop(1, dark);
    ctx.fillStyle = bg;
    roundRect(ctx, x, y, w, h, r);
    ctx.fill();

    // glossy top highlight
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    roundRect(ctx, x + w * 0.09, y + h * 0.05, w * 0.82, h * 0.13, r * 0.6);
    ctx.fill();

    // rear window (glass gradient)
    const gg = ctx.createLinearGradient(x, y + h * 0.24, x, y + h * 0.48);
    gg.addColorStop(0, 'rgba(150,190,225,0.8)');
    gg.addColorStop(1, 'rgba(35,55,85,0.9)');
    ctx.fillStyle = gg;
    roundRect(ctx, x + w * 0.2, y + h * 0.24, w * 0.6, h * 0.22, Math.max(3, r * 0.4));
    ctx.fill();

    // trunk seam
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.fillRect(x + w * 0.12, y + h * 0.7, w * 0.76, Math.max(1, h * 0.025));

    // glowing tail-lights
    ctx.save();
    ctx.shadowColor = 'rgba(255,40,40,0.9)';
    ctx.shadowBlur = Math.max(4, w * 0.14);
    ctx.fillStyle = C.tail;
    roundRect(ctx, x + w * 0.11, y + h * 0.75, w * 0.22, h * 0.1, 2); ctx.fill();
    roundRect(ctx, x + w * 0.67, y + h * 0.75, w * 0.22, h * 0.1, 2); ctx.fill();
    ctx.restore();
  }
}

// ---- helpers --------------------------------------------------------------
function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// Mix a #rrggbb colour toward white by `amt` (0..1) → 'rgb(r,g,b)'.
function lighten(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const mix = (c) => Math.round(c + (255 - c) * amt);
  return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
}

function aabb(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
