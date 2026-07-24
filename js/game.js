// js/game.js
// RacingGame: pseudo-3D endless racer drawn on Canvas 2D, styled as a realistic
// night-city street race (NFS-like) with neon accents, using real image assets.
// Reads a live `tracker` (from createHandTracker) for steering each frame.
// NOTE: webcam-based tracker requires localhost or https to work.

// ---- tunables -------------------------------------------------------------
const CANVAS_W = 960;
const CANVAS_H = 540;

// Low, close chase camera: horizon lower on screen, road fills the width.
const HORIZON_Y = CANVAS_H * 0.40;
const ROAD_NEAR_HALF = CANVAS_W * 0.62; // very wide near — road fills the screen edges
const ROAD_FAR_HALF = CANVAS_W * 0.055; // vanishing-point half width
const BEND_MAX = CANVAS_W * 0.26;       // max autonomous road bend at the horizon

const STEER_MOVE = 560;    // lateral car speed per steering unit
const PLAYER_MAX_X = 1.08; // how far past the road edge the car can slide

const PLAYER_Y = CANVAS_H - 42;  // car sits low/close to the camera
const PLAYER_NEAR_W = 196;       // on-screen width of the player car

const START_LIVES = 3;
const INVULN_TIME = 1.6;
const NO_HANDS_GRACE = 0.4;

const DIFFICULTY = {
  easy:   { key: 'easy',   label: '쉬움',   startSpeed: 150, maxSpeed: 520,  accel: 5,  spawnBase: 1.25, burst: 1 },
  medium: { key: 'medium', label: '중간',   startSpeed: 220, maxSpeed: 880,  accel: 9,  spawnBase: 0.75, burst: 1 },
  hard:   { key: 'hard',   label: '어려움', startSpeed: 340, maxSpeed: 1150, accel: 14, spawnBase: 0.42, burst: 2 },
};

// ---- image assets — resolved relative to index.html -----------------------
function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.__ok = false;
  img.onload = () => { img.__ok = true; };
  img.src = src;
  return img;
}
const IMG = {
  player: loadImage('assets/car-player.png'),
  muscle: loadImage('assets/car-muscle.png'),
  suv: loadImage('assets/car-suv.png'),
  taxi: loadImage('assets/car-taxi.png'),
  cone: loadImage('assets/cone.png'),
  barrier: loadImage('assets/barrier.png'),
  bld: [
    loadImage('assets/bld-glass.png'),
    loadImage('assets/bld-apt.png'),
    loadImage('assets/bld-billboard.png'),
    loadImage('assets/bld-industrial.png'),
  ],
};

// Obstacle catalogue — cars + road props. nearW = on-screen width when closest;
// hitW/hitH = collision box as a fraction of the drawn sprite; weight = rarity.
const OBSTACLE_TYPES = [
  { img: 'muscle',  nearW: 150, hitW: 0.60, hitH: 0.5,  weight: 20 },
  { img: 'suv',     nearW: 150, hitW: 0.58, hitH: 0.56, weight: 18 },
  { img: 'taxi',    nearW: 150, hitW: 0.60, hitH: 0.5,  weight: 15 },
  { img: 'cone',    nearW: 56,  hitW: 0.5,  hitH: 0.45, weight: 27 },
  { img: 'barrier', nearW: 138, hitW: 0.82, hitH: 0.5,  weight: 20 },
];
const OBSTACLE_WEIGHT_TOTAL = OBSTACLE_TYPES.reduce((a, t) => a + t.weight, 0);
// Player hitbox is a touch smaller than a car's for slightly forgiving hits.
const PLAYER_HIT_W = 0.54;
const PLAYER_HIT_H = 0.46;

// project a world half-width at a given screen y (linear perspective)
function roadHalfAt(y) {
  const t = (y - HORIZON_Y) / (CANVAS_H - HORIZON_Y);
  const tc = Math.max(0, Math.min(1, t));
  return ROAD_FAR_HALF + (ROAD_NEAR_HALF - ROAD_FAR_HALF) * tc;
}

// perspective scale (0 at horizon -> 1 at bottom)
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

    this.speed = (this.diff || DIFFICULTY.medium).startSpeed;
    this.distance = 0;
    this.lives = START_LIVES;

    this.playerX = 0;
    this.roadOffset = 0;
    this.curve = 0;
    this.roadPhase = 0;

    this.obstacles = [];      // { lane, y, hit, type }
    this.spawnTimer = 0;

    this.scenery = [];        // roadside buildings { side, lane, y, idx, nearH }
    this.scenTimer = 0;

    this.invuln = 0;
    this.gameOver = false;
    this.practice = false;
    this.countdown = 0;
    this.paused = false;
    this.noHandsTimer = 0;

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
    if (dt > 0.05) dt = 0.05;

    this._update(dt);
    this._render();

    if (this.running) this.rafId = requestAnimationFrame(this._loop);
  }

  _update(dt) {
    // Pre-race countdown — car stays put; road holds its bend.
    if (this.countdown > 0) {
      this.countdown -= dt;
      if (this.countdown <= 0 && typeof this.tracker.calibrate === 'function') {
        this.tracker.calibrate();
      }
      this._updateHud();
      return;
    }

    // Auto-pause when both hands leave the camera; resume with a fresh countdown.
    if (this.tracker.detected) {
      this.noHandsTimer = 0;
      if (this.paused) {
        this.paused = false;
        this.countdown = 3;
        this._updateHud();
        return;
      }
    } else {
      this.noHandsTimer += dt;
      if (!this.paused && this.noHandsTimer > NO_HANDS_GRACE) this.paused = true;
    }
    if (this.paused) { this._updateHud(); return; }

    const steering = clamp(this.tracker.steering || 0, -1, 1);

    this.speed = Math.min(this.diff.maxSpeed, this.speed + this.diff.accel * dt);
    this.distance += this.speed * dt * 0.05;

    // steering moves ONLY the car
    this.playerX += steering * STEER_MOVE * dt / ROAD_NEAR_HALF;
    this.playerX = clamp(this.playerX, -PLAYER_MAX_X, PLAYER_MAX_X);

    // road winds on its own (gentle, independent of steering) for a sense of travel
    this.roadPhase += (0.12 + this.speed * 0.0007) * dt;
    const targetCurve =
      0.32 * Math.sin(this.roadPhase) + 0.11 * Math.sin(this.roadPhase * 0.53 + 2.0);
    this.curve += (targetCurve - this.curve) * Math.min(1, dt * 2.5);

    this.roadOffset = (this.roadOffset + this.speed * dt) % 80;
    if (this.invuln > 0) this.invuln = Math.max(0, this.invuln - dt);

    // Roadside buildings (both modes) rush past + form the converging city.
    const smove = this.speed * dt;
    for (const o of this.scenery) o.y += smove * (0.55 + depthScale(o.y) * 1.25);
    this.scenery = this.scenery.filter((o) => o.y < CANVAS_H + 260);
    this.scenTimer -= dt;
    if (this.scenTimer <= 0) {
      this.scenTimer = 0.09;   // dense city street
      this._spawnStructure(Math.random() < 0.5 ? -1 : 1);
    }

    if (!this.practice) {
      this.spawnTimer -= dt;
      const spawnInterval = Math.max(
        0.26,
        this.diff.spawnBase * (this.diff.startSpeed / this.speed) + 0.14
      );
      if (this.spawnTimer <= 0) {
        this.spawnTimer = spawnInterval;
        for (let b = 0; b < this.diff.burst; b++) this._spawnObstacle();
      }

      const move = this.speed * dt;
      for (const o of this.obstacles) o.y += move * (0.4 + depthScale(o.y) * 1.15);
      this.obstacles = this.obstacles.filter((o) => o.y < CANVAS_H + 140);

      this._checkCollisions();
    }

    this._updateHud();
  }

  _spawnObstacle() {
    const lane = (Math.random() * 1.5) - 0.75;
    // weighted pick of an obstacle type
    let r = Math.random() * OBSTACLE_WEIGHT_TOTAL;
    let type = OBSTACLE_TYPES[0];
    for (const t of OBSTACLE_TYPES) { if ((r -= t.weight) <= 0) { type = t; break; } }
    this.obstacles.push({ lane, y: HORIZON_Y + 2, hit: false, type });
  }

  _spawnStructure(side) {
    const idx = Math.floor(Math.random() * IMG.bld.length);
    this.scenery.push({
      side,
      lane: side * (1.05 + Math.random() * 0.62),   // hug the road edge → city canyon
      y: HORIZON_Y + 2,
      idx,
      nearH: 340 + Math.random() * 220,
    });
  }

  // ---- collision --------------------------------------------------------
  _checkCollisions() {
    if (this.invuln > 0) return;
    const p = this._playerBox();
    for (const o of this.obstacles) {
      if (o.hit) continue;
      const r = this._obstacleBox(o);
      if (r.y + r.h < p.y) continue;
      if (aabb(p, r)) {
        o.hit = true;
        this.lives -= 1;
        this.invuln = INVULN_TIME;
        if (this.lives <= 0) { this.lives = 0; this._endGame(); }
        break;
      }
    }
  }

  _playerBox() {
    const half = roadHalfAt(PLAYER_Y);
    const cx = roadCenterX(PLAYER_Y, this.curve) + this.playerX * half;
    const h = PLAYER_NEAR_W / spriteAspect(IMG.player, 2);
    const cw = PLAYER_NEAR_W * PLAYER_HIT_W, ch = h * PLAYER_HIT_H;
    const cy = PLAYER_Y - h * 0.42;
    return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
  }

  _obstacleBox(o) {
    const s = depthScale(o.y);
    const half = roadHalfAt(o.y);
    const cx = roadCenterX(o.y, this.curve) + o.lane * half;
    const drawW = o.type.nearW * (0.14 + s * 0.86);
    const h = drawW / spriteAspect(IMG[o.type.img], 1.6);
    const cw = drawW * o.type.hitW, ch = h * o.type.hitH;
    const cy = o.y - h * 0.42;
    return { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch };
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
      this.hudScore.textContent = scoreStr; this._lastScoreStr = scoreStr;
    }
    const livesStr = this.practice ? '🟢 연습' : this.lives > 0 ? '❤'.repeat(this.lives) : '💀';
    if (livesStr !== this._lastLivesStr && this.hudLives) {
      this.hudLives.textContent = livesStr; this._lastLivesStr = livesStr;
    }
    const speedStr = '속도: ' + Math.floor(this.speed / 3) + ' km/h';
    if (speedStr !== this._lastSpeedStr && this.hudSpeed) {
      this.hudSpeed.textContent = speedStr; this._lastSpeedStr = speedStr;
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

  _drawSky(ctx) {
    // deep night gradient
    const g = ctx.createLinearGradient(0, 0, 0, HORIZON_Y);
    g.addColorStop(0, '#05060b');
    g.addColorStop(0.7, '#0a0c15');
    g.addColorStop(1, '#15112a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y);

    // distant city glow at the vanishing point (warm sodium + cool haze)
    const vx = roadCenterX(HORIZON_Y, this.curve);
    const rg = ctx.createRadialGradient(vx, HORIZON_Y, 4, vx, HORIZON_Y, 200);
    rg.addColorStop(0, 'rgba(255, 176, 110, 0.4)');
    rg.addColorStop(0.4, 'rgba(120, 130, 210, 0.16)');
    rg.addColorStop(1, 'rgba(120, 130, 210, 0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, CANVAS_W, HORIZON_Y + 50);

    // dark wet pavement base below the horizon
    ctx.fillStyle = '#0c0d12';
    ctx.fillRect(0, HORIZON_Y, CANVAS_W, CANVAS_H - HORIZON_Y);
  }

  _drawRoad(ctx) {
    const rows = CANVAS_H - HORIZON_Y;
    for (let i = 0; i <= rows; i += 2) {
      const y = HORIZON_Y + i;
      const s = depthScale(y);
      const half = roadHalfAt(y);
      const cx = roadCenterX(y, this.curve);
      const band = Math.floor((i + this.roadOffset) / (6 + s * 26)) % 2 === 0;

      // pavement / sidewalk beside the road
      ctx.fillStyle = band ? '#0e0f14' : '#0b0c10';
      ctx.fillRect(0, y, CANVAS_W, 2);

      // curb
      const curb = half + 6 + s * 5;
      ctx.fillStyle = band ? '#2f3038' : '#25262d';
      ctx.fillRect(cx - curb, y, curb * 2, 2);

      // wet dark asphalt
      ctx.fillStyle = band ? '#212329' : '#1a1c21';
      ctx.fillRect(cx - half, y, half * 2, 2);

      // solid white edge lines
      if (s > 0.05) {
        const ew = Math.max(1.2, 4 * s);
        ctx.fillStyle = 'rgba(220,220,232,0.55)';
        ctx.fillRect(cx - half + ew * 0.6, y, ew, 2);
        ctx.fillRect(cx + half - ew * 1.6, y, ew, 2);
      }

      // dashed warm centre line + two faint lane dividers
      if (s > 0.06) {
        const laneW = Math.max(1.3, 3.6 * s);
        if (band) {
          ctx.fillStyle = 'rgba(240,222,150,0.8)';
          ctx.fillRect(cx - laneW / 2, y, laneW, 2);
        }
        if (band) {
          ctx.fillStyle = 'rgba(210,210,220,0.28)';
          ctx.fillRect(cx - half * 0.5 - laneW / 2, y, laneW, 2);
          ctx.fillRect(cx + half * 0.5 - laneW / 2, y, laneW, 2);
        }
      }
    }
  }

  // ---- roadside buildings (real image sprites) --------------------------
  _drawScenery(ctx) {
    const sorted = [...this.scenery].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const s = depthScale(o.y);
      if (s <= 0.015) continue;
      const img = IMG.bld[o.idx];
      if (!img.__ok) continue;
      const aspect = img.width / img.height;
      const h = o.nearH * s;
      const w = h * aspect;
      const half = roadHalfAt(o.y);
      const baseX = roadCenterX(o.y, this.curve) + o.lane * half;
      // atmospheric fade — far buildings blend into the night
      ctx.globalAlpha = Math.min(1, 0.32 + s * 0.95);
      ctx.drawImage(img, baseX - w / 2, o.y - h, w, h);
      ctx.globalAlpha = 1;
    }
  }

  _drawObstacles(ctx) {
    const sorted = [...this.obstacles].sort((a, b) => a.y - b.y);
    for (const o of sorted) {
      const s = depthScale(o.y);
      const half = roadHalfAt(o.y);
      const cx = roadCenterX(o.y, this.curve) + o.lane * half;
      const drawW = o.type.nearW * (0.14 + s * 0.86);
      this._drawSprite(ctx, IMG[o.type.img], cx, o.y, drawW);
    }
  }

  _drawPlayer(ctx) {
    if (this.invuln > 0 && Math.floor(this.invuln * 12) % 2 === 0) return;
    const half = roadHalfAt(PLAYER_Y);
    const cx = roadCenterX(PLAYER_Y, this.curve) + this.playerX * half;
    this._drawSprite(ctx, IMG.player, cx, PLAYER_Y, PLAYER_NEAR_W);
  }

  // Draw a transparent sprite bottom-anchored on the ground at (cx, groundY).
  _drawSprite(ctx, img, cx, groundY, drawW) {
    if (!img || !img.__ok) {
      ctx.fillStyle = 'rgba(40,42,52,0.9)';
      roundRect(ctx, cx - drawW / 2, groundY - drawW * 0.5, drawW, drawW * 0.5, 6);
      ctx.fill();
      return;
    }
    const w = drawW;
    const h = w / (img.width / img.height);
    // soft ground shadow / wet contact
    ctx.fillStyle = 'rgba(0,0,0,0.42)';
    ctx.beginPath();
    ctx.ellipse(cx, groundY - 2, w * 0.4, h * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(img, cx - w / 2, groundY - h, w, h);
  }

  _drawVignette(ctx) {
    const g = ctx.createRadialGradient(
      CANVAS_W / 2, CANVAS_H * 0.52, CANVAS_H * 0.34,
      CANVAS_W / 2, CANVAS_H * 0.52, CANVAS_H * 0.9
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }

  _drawCountdown(ctx) {
    const n = Math.ceil(this.countdown);
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 12, 0.5)';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(255, 120, 60, 0.85)';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffb46e';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.24) + 'px "Segoe UI", sans-serif';
    ctx.fillText(String(n), CANVAS_W / 2, CANVAS_H * 0.42);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf0ff';
    ctx.font = 'bold ' + Math.round(CANVAS_H * 0.045) + 'px "Segoe UI", sans-serif';
    ctx.fillText('양손으로 핸들을 잡으세요 · 이 자세가 직진이에요', CANVAS_W / 2, CANVAS_H * 0.62);
    ctx.restore();
  }

  _drawPause(ctx) {
    ctx.save();
    ctx.fillStyle = 'rgba(3, 5, 12, 0.55)';
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
}

// ---- helpers --------------------------------------------------------------
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function spriteAspect(img, fallback) {
  return (img && img.__ok) ? img.width / img.height : fallback;
}

function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
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
